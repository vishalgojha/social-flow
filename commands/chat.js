const chalk = require('chalk');
const { ChatSession } = require('../lib/chat/session');
const { PersistentMemory } = require('../lib/chat/memory');

function printSessions() {
  const sessions = PersistentMemory.list(30);
  if (!sessions.length) {
    console.log(chalk.gray('\nNo chat sessions found.\n'));
    return;
  }
  console.log(chalk.bold('\nRecent Chat Sessions:'));
  sessions.forEach((s) => {
    console.log(`- ${chalk.cyan(s.sessionId)} (${s.updatedAt})`);
  });
  console.log('');
}

function registerChatCommands(program) {
  const chat = program
    .command('chat')
    .description('Start a conversational AI session for Meta APIs')
    .option('--session <id>', 'Resume a specific session id')
    .option('--yes', 'Auto-approve low-risk executions', false)
    .option('--agentic', 'Autonomous terminal mode: auto-execute non-high-risk actions', false)
    .option('--debug', 'Show parser debug logs', false)
    .action(async (opts) => {
      const session = new ChatSession(opts.session, {
        yes: Boolean(opts.yes),
        agentic: Boolean(opts.agentic),
        debug: Boolean(opts.debug)
      });
      await session.start();
    });

  chat
    .command('sessions')
    .description('List recent chat sessions')
    .action(() => {
      printSessions();
    });
}

module.exports = registerChatCommands;
