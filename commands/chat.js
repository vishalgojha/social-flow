const path = require('path');
const { spawn } = require('child_process');
const chalk = require('chalk');
const config = require('../lib/config');
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

function needsOnboarding() {
  return !config.hasCompletedOnboarding();
}

function runSubprocess(args) {
  return new Promise((resolve, reject) => {
    const binPath = path.join(__dirname, '..', 'bin', 'social.js');
    const child = spawn(process.execPath, [binPath, '--no-banner', ...args], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`social ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function registerChatCommands(program) {
  const chat = program
    .command('chat')
    .description('Legacy alias to hatch (agentic terminal chat)')
    .action(async () => {
      if (needsOnboarding()) {
        console.log(chalk.yellow('\nFirst-run setup required before chat.'));
        console.log(chalk.gray('Guided path: onboard -> auth login -> doctor checks.\n'));
        await runSubprocess(['onboard']);
        return;
      }

      console.log(chalk.cyan('\n`social chat` is now routed to Hatch UI. Use `social hatch` directly.\n'));
      await runSubprocess(['hatch']);
    });

  chat
    .command('sessions')
    .description('List recent chat sessions')
    .action(() => {
      printSessions();
    });
}

module.exports = registerChatCommands;
