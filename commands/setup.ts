const path = require('path');
const { spawn } = require('child_process');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const config = require('../lib/config');
const packageJson = require('../package.json');
const { renderPanel, formatBadge, kv } = require('../lib/ui/chrome');
const { buildReadinessReport } = require('../lib/readiness');
const { startGatewayBackground } = require('../lib/gateway/manager');
const { buildGuidanceState, printGuidancePanel } = require('../lib/guidance');

function runSubprocess(args, opts = {}) {
  const capture = Boolean(opts.capture);
  return new Promise((resolve, reject) => {
    const binPath = path.join(__dirname, '..', 'bin', 'social.js');
    const child = spawn(process.execPath, [binPath, '--no-banner', ...args], {
      stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      env: process.env
    });

    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`social ${args.join(' ')} exited with code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function makeSpinner(text) {
  if (!process.stdout.isTTY) return null;
  return ora({ text }).start();
}

function flushCaptured(output) {
  const out = String(output?.stdout || '');
  const err = String(output?.stderr || '');
  if (out) process.stdout.write(out);
  if (err) process.stderr.write(err);
}

function printSetupReport(report, title) {
  const rows = [
    kv('Profile', chalk.cyan(report.activeProfile), { labelWidth: 14 }),
    kv('Default API', chalk.cyan(report.defaultApi || 'facebook'), { labelWidth: 14 }),
    kv('Tokens', report.anyTokenConfigured ? formatBadge('READY', { tone: 'success' }) : formatBadge('MISSING', { tone: 'warn' }), { labelWidth: 14 }),
    kv('Onboarding', report.onboardingCompleted ? formatBadge('DONE', { tone: 'success' }) : formatBadge('PENDING', { tone: 'warn' }), { labelWidth: 14 }),
    kv('App Credentials', report.appCredentialsConfigured ? formatBadge('READY', { tone: 'success' }) : formatBadge('PENDING', { tone: 'warn' }), { labelWidth: 14 })
  ];

  const issueRows = [];
  report.blockers.forEach((item, index) => issueRows.push(`${index + 1}. ${chalk.red(item.message)} ${chalk.gray(`(${item.fix})`)}`));
  report.warnings.forEach((item, index) => issueRows.push(`${report.blockers.length + index + 1}. ${chalk.yellow(item.message)} ${chalk.gray(`(${item.fix})`)}`));
  if (!issueRows.length) issueRows.push(chalk.green('No blocking setup gaps detected.'));

  console.log('');
  console.log(renderPanel({
    title: ` ${title} `,
    rows,
    minWidth: 82,
    borderColor: (value) => chalk.cyan(value)
  }));
  console.log('');
  console.log(renderPanel({
    title: ' Gaps + Next Actions ',
    rows: issueRows,
    minWidth: 82,
    borderColor: (value) => chalk.blue(value)
  }));
  console.log('');
}

async function shouldConfigureAppCredentials(opts) {
  if (opts.skipApp) return false;
  if (!process.stdout.isTTY) return false;
  if (opts.quick) return true;

  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Configure App ID/App Secret now? (recommended)',
      default: true
    }
  ]);
  return Boolean(answer.confirm);
}

function registerSetupCommand(program) {
  program
    .command('setup')
    .description('Guided first-run setup with readiness checks and optional gateway start')
    .option('--quick', 'Run setup with minimal prompts', false)
    .option('--skip-app', 'Skip App ID/App Secret step')
    .option('--no-start', 'Do not auto-start the gateway after setup')
    .option('--host <host>', 'Gateway host for auto-start', process.env.PORT ? '0.0.0.0' : '127.0.0.1')
    .option('--port <port>', 'Gateway port for auto-start', process.env.PORT || '1310')
    .action(async (opts) => {
      const initial = buildReadinessReport();
      printSetupReport(initial, ' Setup Snapshot ');

      if (!initial.anyTokenConfigured) {
        console.log(chalk.cyan('[1/3] Running onboarding (token setup)\n'));
        await runSubprocess(['onboard', '--quick', '--no-hatch']);
      } else if (!initial.onboardingCompleted) {
        config.markOnboardingComplete({ version: packageJson.version });
        console.log(chalk.green('Marked onboarding as complete for current profile.\n'));
      }

      const afterToken = buildReadinessReport();
      if (!afterToken.appCredentialsConfigured && (await shouldConfigureAppCredentials(opts))) {
        console.log(chalk.cyan('[2/3] Configuring app credentials\n'));
        await runSubprocess(['auth', 'app']);
      }

      console.log(chalk.cyan('[3/3] Running diagnostics\n'));
      const diagnosticsSpinner = makeSpinner('Running diagnostics...');
      try {
        const diagnosticsOut = await runSubprocess(['doctor'], { capture: true });
        if (diagnosticsSpinner) diagnosticsSpinner.succeed('Diagnostics complete');
        flushCaptured(diagnosticsOut);
      } catch (error) {
        if (diagnosticsSpinner) diagnosticsSpinner.fail('Diagnostics failed');
        flushCaptured(error);
        throw error;
      }

      const finalReport = buildReadinessReport();
      printSetupReport(finalReport, ' Setup Result ');
      const guidance = await buildGuidanceState({
        host: opts.host,
        port: opts.port,
        readiness: finalReport
      });
      printGuidancePanel(guidance, { title: ' Universal Guidance Sequence ' });

      if (!finalReport.ok) {
        console.log(chalk.red('Setup finished, but required items are still missing.\n'));
        process.exit(1);
      }

      if (opts.start === false) {
        console.log(chalk.green('Setup complete. Gateway was not started.'));
        console.log(chalk.gray('Next: social start\n'));
        return;
      }

      const gatewaySpinner = makeSpinner('Starting gateway and waiting for health...');
      let startRes;
      try {
        startRes = await startGatewayBackground({
          host: opts.host,
          port: opts.port
        });
        if (gatewaySpinner) gatewaySpinner.succeed('Gateway launch step complete');
      } catch (error) {
        if (gatewaySpinner) gatewaySpinner.fail('Gateway launch failed');
        throw error;
      }

      const url = `http://${startRes.status.host}:${startRes.status.port}`;
      if (startRes.health && startRes.health.ok) {
        if (startRes.started) console.log(chalk.green(`Gateway started: ${url}`));
        else if (startRes.external) console.log(chalk.green(`Gateway already running (unmanaged process): ${url}`));
        else console.log(chalk.green(`Gateway already running: ${url}`));
      } else {
        console.log(chalk.yellow(`Gateway launch requested, but health is not ready yet. Check logs with: social logs`));
      }
      console.log(chalk.gray(`Health: ${url}/api/health\n`));
    });
}

module.exports = registerSetupCommand;
