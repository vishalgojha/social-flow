const path = require('path');
const { spawn } = require('child_process');
const inquirer = require('inquirer');
const chalk = require('chalk');
const config = require('../lib/config');
const packageJson = require('../package.json');
const { readyLines } = require('../lib/ui/onboarding-ready');

function runSubprocess(args) {
  return new Promise((resolve, reject) => {
    const binPath = path.join(__dirname, '..', 'bin', 'social.js');
    const child = spawn(process.execPath, [binPath, ...args], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: social ${args.join(' ')} (code ${code})`));
    });
  });
}

function registerOnboardCommand(program) {
  program
    .command('onboard')
    .description('Interactive onboarding wizard (tokens + basic health checks)')
    .option('--quick', 'Only onboard one API and skip additional prompts', false)
    .option('--no-hatch', 'Do not auto-start hatch UI after onboarding')
    .action(async (opts) => {
      console.log(chalk.cyan('\n[1/3] Select API and login\n'));
      const first = await inquirer.prompt([
        {
          type: 'list',
          name: 'api',
          message: 'Select primary API to onboard:',
          choices: [
            { name: 'Facebook', value: 'facebook' },
            { name: 'Instagram', value: 'instagram' },
            { name: 'WhatsApp', value: 'whatsapp' }
          ]
        }
      ]);

      await runSubprocess(['auth', 'login', '-a', first.api]);

      if (!opts.quick) {
        console.log(chalk.cyan('\n[2/3] Optional additional API logins\n'));
        const more = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'setupMore',
            message: 'Do you want to login another API now?',
            default: false
          }
        ]);
        if (more.setupMore) {
          const second = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'apis',
              message: 'Select additional APIs to login:',
              choices: [
                { name: 'Facebook', value: 'facebook' },
                { name: 'Instagram', value: 'instagram' },
                { name: 'WhatsApp', value: 'whatsapp' }
              ]
            }
          ]);
          for (const api of second.apis || []) {
            // eslint-disable-next-line no-await-in-loop
            await runSubprocess(['auth', 'login', '-a', api]);
          }
        }
      }

      console.log(chalk.cyan('\n[3/3] Running doctor checks\n'));
      await runSubprocess(['doctor']);
      config.markOnboardingComplete({ version: packageJson.version });

      console.log(chalk.green('\nOnboarding complete.\n'));
      readyLines({ profile: config.getActiveProfile() }).forEach((line) => {
        if (/^\d+\./.test(line)) {
          console.log(chalk.cyan(line));
        } else if (line === 'You are now ready.') {
          console.log(chalk.green.bold(line));
        } else {
          console.log(chalk.gray(line));
        }
      });
      console.log('');

      if (process.stdout.isTTY && opts.hatch !== false) {
        console.log(chalk.cyan('Starting Hatch UI...\n'));
        await runSubprocess(['hatch']);
      }
    });
}

module.exports = registerOnboardCommand;
