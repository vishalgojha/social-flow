const chalk = require('chalk');
const inquirer = require('inquirer');
const ora = require('ora');
const config = require('../config');
const { ConversationContext } = require('./context');
const { AutonomousAgent } = require('./agent');
const { PersistentMemory } = require('./memory');

function bubble(role, text) {
  const lines = String(text || '').split('\n');
  const width = Math.max(18, ...lines.map((l) => l.length));
  const top = `+${'-'.repeat(width + 2)}+`;
  const body = lines.map((l) => `| ${l.padEnd(width)} |`).join('\n');
  const box = `${top}\n${body}\n${top}`;
  if (role === 'agent') return chalk.green(box);
  if (role === 'system') return chalk.cyan(box);
  return chalk.yellow(box);
}

function printAgentMessage(text) {
  console.log('');
  console.log(bubble('agent', `Agent\n\n${text}`));
  console.log('');
}

function printSystemMessage(text) {
  console.log('');
  console.log(bubble('system', text));
  console.log('');
}

function formatActionList(actions) {
  if (!Array.isArray(actions) || !actions.length) return '';
  const lines = ['Proposed actions:'];
  actions.forEach((a, i) => {
    lines.push(`${i + 1}. ${a.tool}${a.description ? ` - ${a.description}` : ''}`);
  });
  return lines.join('\n');
}

function formatSuggestionList(suggestions) {
  const safe = Array.isArray(suggestions) ? suggestions.filter(Boolean) : [];
  if (!safe.length) return '';
  const lines = ['Suggestions:'];
  safe.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  return lines.join('\n');
}

class ChatSession {
  constructor(sessionId, options = {}) {
    this.options = options;
    this.memory = new PersistentMemory(sessionId);
    this.context = new ConversationContext();
    this.agent = new AutonomousAgent({
      context: this.context,
      config,
      options
    });
  }

  async loadIfAny() {
    if (!this.memory.exists()) return false;
    const payload = this.memory.load();
    if (!payload || !payload.context) return false;
    this.context = new ConversationContext(payload.context);
    this.agent = new AutonomousAgent({
      context: this.context,
      config,
      options: this.options
    });
    return true;
  }

  async persist() {
    this.memory.save({
      context: this.context.toJSON()
    });
  }

  showHelp() {
    printSystemMessage([
      'Examples:',
      '- "I need to launch our new product tomorrow"',
      '- "Post this to Facebook and Instagram at 10am tomorrow"',
      '- "Check my ad performance for last 7 days"',
      '- "Send WhatsApp message to +15551234567 saying order confirmed"',
      '',
      'Commands:',
      '- help: show this help',
      '- summary: show session summary',
      '- exit: save and quit'
    ].join('\n'));
  }

  showSummary() {
    const s = this.context.getSummary();
    printSystemMessage([
      `Session: ${this.memory.id}`,
      `Pending actions: ${s.pendingActions}`,
      `Executed actions: ${s.executedActions}`,
      `Facts: ${JSON.stringify(s.facts)}`
    ].join('\n'));
  }

  async promptUser() {
    const ans = await inquirer.prompt([
      {
        type: 'input',
        name: 'text',
        message: 'You:'
      }
    ]);
    return String(ans.text || '').trim();
  }

  async executeActions(actions) {
    const allSuggestions = [];
    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      const spinner = ora(action.description || `Running ${action.tool}...`).start();
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.agent.execute(action);
        spinner.succeed(chalk.green(result.summary));
        this.context.addResult(action, result.raw);
        (result.suggestions || []).forEach((s) => allSuggestions.push(s));
      } catch (error) {
        const fail = this.agent.failureAdvice(action, error);
        spinner.fail(chalk.red(String(fail.message || error.message || error)));
        if (Array.isArray(fail.suggestions) && fail.suggestions.length) {
          fail.suggestions.forEach((s) => allSuggestions.push(s));
        }
        this.context.addError(action, error);
      }
    }
    return allSuggestions;
  }

  async start() {
    printSystemMessage([
      'Meta AI Chat Agent Ready',
      '',
      `Session: ${this.memory.id}`,
      'Type "help" for examples, "exit" to quit.'
    ].join('\n'));

    const resumed = await this.loadIfAny();
    if (resumed) {
      printSystemMessage(`Resumed previous session: ${this.memory.id}`);
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const userInput = await this.promptUser();
      if (!userInput) continue;
      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        await this.persist();
        printSystemMessage('Session saved. See you next time.');
        break;
      }
      if (userInput.toLowerCase() === 'help') {
        this.showHelp();
        continue;
      }
      if (userInput.toLowerCase() === 'summary') {
        this.showSummary();
        continue;
      }

      let response;
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await this.agent.process(userInput);
      } catch (error) {
        printAgentMessage(`I hit an error while planning: ${error.message}`);
        // eslint-disable-next-line no-await-in-loop
        await this.persist();
        continue;
      }

      const planText = response.actions.length
        ? `${response.message}\n\n${formatActionList(response.actions)}`
        : response.message;
      const responseSuggestions = formatSuggestionList(response.suggestions);
      printAgentMessage(responseSuggestions ? `${planText}\n\n${responseSuggestions}` : planText);

      if (response.actions && response.actions.length > 0 && this.context.hasPendingActions()) {
        if (this.options.yes && !response.needsInput) {
          // eslint-disable-next-line no-await-in-loop
          await this.executeActions(response.actions);
        }
      }

      // If the latest user message already confirmed pending work, process() returns actions to execute immediately.
      if (response.actions && response.actions.length > 0 && !response.needsInput) {
        // eslint-disable-next-line no-await-in-loop
        const actionSuggestions = await this.executeActions(response.actions);
        const followUp = this.context.lastResults[this.context.lastResults.length - 1];
        if (followUp && !followUp.error) {
          const proactive = formatSuggestionList(actionSuggestions);
          const doneText = proactive
            ? `Done.\n\n${proactive}\n\nWant me to do anything else in this session?`
            : 'Done. Want me to do anything else in this session?';
          printAgentMessage(doneText);
        }
      }

      // eslint-disable-next-line no-await-in-loop
      await this.persist();
    }
  }
}

module.exports = {
  ChatSession
};
