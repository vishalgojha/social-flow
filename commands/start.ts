const path = require('path');
const { spawn } = require('child_process');
const chalk = require('chalk');
const { buildReadinessReport } = require('../lib/readiness');
const { startGatewayBackground } = require('../lib/gateway/manager');
const { renderPanel } = require('../lib/ui/chrome');
const { openUrl } = require('../lib/open-url');

function runForeground(args) {
  return new Promise((resolve, reject) => {
    const binPath = path.join(__dirname, '..', 'bin', 'social.js');
    const child = spawn(process.execPath, [binPath, '--no-banner', 'gateway', ...args], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`social gateway exited with code ${code}`));
    });
  });
}

function printBlockers(report) {
  const rows = report.blockers.map((item, index) => `${index + 1}. ${chalk.red(item.message)} ${chalk.gray(`(${item.fix})`)}`);
  rows.push('');
  rows.push(chalk.yellow('Run `social setup` to resolve automatically.'));
  rows.push(chalk.gray('Use `social start --force` only if you intentionally want a partial setup.'));
  console.log('');
  console.log(renderPanel({
    title: ' Start Blocked ',
    rows,
    minWidth: 84,
    borderColor: (value) => chalk.yellow(value)
  }));
  console.log('');
}

function registerStartCommand(program) {
  const defaultHost = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
  const defaultPort = process.env.PORT || '1310';

  program
    .command('start')
    .description('Start the API gateway with readiness checks (background by default)')
    .option('--host <host>', 'Host address', defaultHost)
    .option('--port <port>', 'Port number', defaultPort)
    .option('--api-key <key>', 'Gateway API key for protected access (header: x-gateway-key)')
    .option('--require-api-key', 'Require API key even for localhost requests', false)
    .option('--cors-origins <csv>', 'Comma-separated allowed CORS origins')
    .option('--rate-limit-max <n>', 'Max API requests per window', '180')
    .option('--rate-limit-window-ms <ms>', 'Rate limit window in milliseconds', '60000')
    .option('--foreground', 'Run in current terminal (Ctrl+C to stop)', false)
    .option('--force', 'Bypass readiness blockers', false)
    .option('--open', 'Open gateway status page in browser after launch', false)
    .action(async (opts) => {
      const report = buildReadinessReport();
      if (!report.ok && !opts.force) {
        printBlockers(report);
        process.exit(1);
      }

      const gatewayArgs = [
        '--host', String(opts.host || defaultHost),
        '--port', String(opts.port || defaultPort),
        '--rate-limit-max', String(opts.rateLimitMax || '180'),
        '--rate-limit-window-ms', String(opts.rateLimitWindowMs || '60000')
      ];
      if (opts.apiKey) gatewayArgs.push('--api-key', String(opts.apiKey));
      if (opts.requireApiKey) gatewayArgs.push('--require-api-key');
      if (opts.corsOrigins) gatewayArgs.push('--cors-origins', String(opts.corsOrigins));

      if (opts.foreground) {
        console.log(chalk.cyan('Starting gateway in foreground (same terminal). Press Ctrl+C to stop.\n'));
        await runForeground(gatewayArgs);
        return;
      }

      const started = await startGatewayBackground({
        host: opts.host,
        port: opts.port,
        apiKey: opts.apiKey,
        requireApiKey: Boolean(opts.requireApiKey),
        corsOrigins: opts.corsOrigins,
        rateLimitMax: opts.rateLimitMax,
        rateLimitWindowMs: opts.rateLimitWindowMs
      });

      const url = `http://${started.status.host}:${started.status.port}`;
      if (started.started) console.log(chalk.green(`Gateway started in background: ${url}`));
      else if (started.external) console.log(chalk.green(`Gateway already running (unmanaged process): ${url}`));
      else console.log(chalk.green(`Gateway already running: ${url}`));

      if (started.health && started.health.ok) {
        console.log(chalk.gray(`Health: ${url}/api/health (ok)`));
      } else {
        console.log(chalk.yellow(`Health not ready yet. Use \`social status\` or \`social logs\`.`));
      }

      if (opts.open) {
        await openUrl(`${url}/api/status?doctor=1`);
      }

      console.log(chalk.gray('Stop later with: social stop\n'));
    });
}

module.exports = registerStartCommand;
