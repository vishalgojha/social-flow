const http = require('http');
const chalk = require('chalk');
const { openUrl } = require('../lib/open-url');
const { startGatewayBackground } = require('../lib/gateway/manager');
const { renderPanel, mint } = require('../lib/ui/chrome');

function parseBaseUrl(input) {
  const raw = String(input || 'http://127.0.0.1:1310').trim();
  try {
    return new URL(raw);
  } catch {
    return new URL(`http://${raw}`);
  }
}

function requestJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let data = {};
        try {
          data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          data = {};
        }
        resolve({
          status: res.statusCode || 0,
          data
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, data: {} });
    });
    req.on('error', () => resolve({ status: 0, data: {} }));
  });
}

function registerStudioCommand(program) {
  program
    .command('studio')
    .description('Open external frontend or gateway status page')
    .option('--url <url>', 'Gateway base URL', 'http://127.0.0.1:1310')
    .option('--frontend-url <url>', 'External Studio/frontend URL to open', process.env.SOCIAL_STUDIO_URL || '')
    .option('--no-open', 'Do not open Studio page in browser')
    .option('--no-auto-start', 'Do not auto-start gateway when health is down')
    .action(async (opts) => {
      const baseUrl = parseBaseUrl(opts.url);
      const healthUrl = new URL('/api/health', baseUrl).toString();
      const statusUrl = new URL('/api/status?doctor=1', baseUrl).toString();
      const frontendUrl = String(opts.frontendUrl || '').trim();
      const host = String(baseUrl.hostname || '127.0.0.1').trim();
      const fallbackPort = baseUrl.protocol === 'https:' ? 443 : 80;
      const port = Number(baseUrl.port || fallbackPort);

      let health = await requestJson(healthUrl);
      let autoStarted = false;

      if ((!health || !health.data || !health.data.ok) && opts.autoStart !== false) {
        const started = await startGatewayBackground({ host, port });
        autoStarted = Boolean(started.started);
        health = started.health && started.health.ok
          ? { status: 200, data: started.health.data || { ok: true } }
          : await requestJson(healthUrl);
      }

      const rows = [];
      if (health.status === 200 && health.data && health.data.ok) {
        rows.push(chalk.green(`Gateway reachable: ${baseUrl.toString().replace(/\/$/, '')}`));
        rows.push(chalk.gray(`Health endpoint: ${healthUrl}`));
        rows.push(chalk.gray(`Status page: ${statusUrl}`));
        if (frontendUrl) rows.push(chalk.gray(`External frontend: ${frontendUrl}`));
        if (autoStarted) rows.push(chalk.green('Gateway auto-started for Studio flow.'));
      } else {
        rows.push(chalk.red(`Gateway not reachable at ${baseUrl.toString().replace(/\/$/, '')}`));
        rows.push(chalk.yellow('Start it first: social start'));
        rows.push(chalk.gray('For debugging: social logs --lines 120'));
      }

      rows.push('');
      rows.push('Fast checks:');
      rows.push(`1. curl ${healthUrl}`);
      rows.push(`2. social status`);
      rows.push('3. social logs');
      rows.push(`4. open ${frontendUrl || statusUrl}`);

      console.log('');
      console.log(renderPanel({
        title: ' Studio Mode ',
        rows,
        minWidth: 88,
        borderColor: (value) => mint(value)
      }));
      console.log('');

      if (opts.open !== false && health.status === 200 && health.data && health.data.ok) {
        const openTarget = frontendUrl || statusUrl;
        await openUrl(openTarget);
      }
    });
}

module.exports = registerStudioCommand;
