const path = require('path');
const { spawn } = require('child_process');
const inquirer = require('inquirer');
const chalk = require('chalk');
const config = require('../config');

function isOnboarded() {
  return config.hasCompletedOnboarding();
}

function tokenBadge(label, ok) {
  return `${label}:${ok ? chalk.green('OK') : chalk.yellow('--')}`;
}

function printFrame(onboarded) {
  const title = ' Social CLI Launcher ';
  const line = '─'.repeat(68);
  const fb = config.hasToken('facebook');
  const ig = config.hasToken('instagram');
  const wa = config.hasToken('whatsapp');
  const status = onboarded ? chalk.green('ONBOARDED') : chalk.yellow('NOT_ONBOARDED');

  console.log(chalk.cyan(`\n┌${line}┐`));
  console.log(chalk.cyan(`│${title.padEnd(68, ' ')}│`));
  console.log(chalk.cyan(`├${line}┤`));
  console.log(chalk.cyan(`│ Status: ${status} ${' '.repeat(49)}│`));
  console.log(chalk.cyan(`│ ${tokenBadge('facebook', fb)}  ${tokenBadge('instagram', ig)}  ${tokenBadge('whatsapp', wa)}${' '.repeat(8)}│`));
  console.log(chalk.cyan(`├${line}┤`));
  console.log(chalk.cyan(`│ [o] Onboard   [h] Hatch UI                [d] Doctor   [q] Exit ${' '.repeat(1)}│`));
  console.log(chalk.cyan(`│ [enter] default action (${onboarded ? 'hatch' : 'onboard'})${' '.repeat(onboarded ? 20 : 18)}│`));
  console.log(chalk.cyan(`└${line}┘`));
}

function printHelpCommands() {
  console.log(chalk.bold('\nHelp Commands'));
  console.log(chalk.gray('  social onboard'));
  console.log(chalk.gray('  social doctor'));
  console.log(chalk.gray('  social auth login -a facebook'));
  console.log(chalk.gray('  social tui             # hatch UI (terminal chat)'));
  console.log(chalk.gray('  social gateway         # API gateway'));
  console.log(chalk.gray('  social --help'));
  console.log('');
}

function runCommand(binPath, args) {
  return new Promise((resolve, reject) => {
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

async function startLauncherMenu(binPath) {
  console.log(chalk.cyan('\nSocial CLI Interactive Menu'));
  console.log(chalk.gray('OpenClaw-style launcher: onboard first, then hatch/web.\n'));
  if (!isOnboarded()) {
    console.log(chalk.yellow('First run detected: start with [o] Onboard.\n'));
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const onboarded = isOnboarded();
    printFrame(onboarded);

    // eslint-disable-next-line no-await-in-loop
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'choice',
        message: 'Select action key',
        default: onboarded ? 'h' : 'o',
        filter: (value) => String(value || '').trim().toLowerCase(),
        validate: (value) => {
          const key = String(value || '').trim().toLowerCase();
          if (['o', 'h', 'd', 'q', '?'].includes(key)) return true;
          return 'Use one key: o/h/d/q/?';
        }
      }
    ]);

    const key = answer.choice || (onboarded ? 'h' : 'o');
    if (key === 'q') return;
    if (key === '?') {
      printHelpCommands();
      continue;
    }
    if (!onboarded && ['h', 'd'].includes(key)) {
      console.log(chalk.yellow('\nRun onboarding first (press o).\n'));
      continue;
    }

    try {
      if (key === 'o') {
        // eslint-disable-next-line no-await-in-loop
        await runCommand(binPath, ['onboard']);
      } else if (key === 'd') {
        // eslint-disable-next-line no-await-in-loop
        await runCommand(binPath, ['doctor']);
      } else if (key === 'h') {
        // eslint-disable-next-line no-await-in-loop
        await runCommand(binPath, ['tui']);
      }
    } catch (err) {
      console.log(chalk.red(`\n${String((err && err.message) || err)}\n`));
    }
  }
}

module.exports = {
  startLauncherMenu
};
