const chalk = require('chalk');
const config = require('../lib/config');
const { parseIntent, preflightFor } = require('../lib/policy/preflight');

function registerPolicyCommands(program) {
  const policy = program.command('policy').description('Region-aware policy and preflight checks');

  const region = policy.command('region').description('Workspace region metadata');

  region
    .command('show')
    .description('Show current region config')
    .option('--json', 'Output JSON')
    .action((options) => {
      const out = config.getRegionConfig();
      if (options.json) {
        console.log(JSON.stringify({ profile: config.getActiveProfile(), region: out }, null, 2));
        return;
      }
      console.log(chalk.bold('\nRegion Config'));
      console.log(chalk.gray(`  profile: ${config.getActiveProfile()}`));
      console.log(chalk.gray(`  country: ${out.country || '(not set)'}`));
      console.log(chalk.gray(`  timezone: ${out.timezone || '(not set)'}`));
      console.log(chalk.gray(`  mode: ${out.regulatoryMode}\n`));
    });

  region
    .command('set')
    .description('Set region config')
    .option('--country <code>', 'Country code, e.g. IN, US, DE')
    .option('--timezone <iana>', 'IANA timezone, e.g. Asia/Kolkata')
    .option('--mode <mode>', 'Regulatory mode: standard|strict')
    .option('--json', 'Output JSON')
    .action((options) => {
      const patch = {};
      if (options.country !== undefined) patch.country = options.country;
      if (options.timezone !== undefined) patch.timezone = options.timezone;
      if (options.mode !== undefined) patch.regulatoryMode = options.mode;
      const next = config.setRegionConfig(patch);
      if (options.json) {
        console.log(JSON.stringify({ profile: config.getActiveProfile(), region: next }, null, 2));
        return;
      }
      console.log(chalk.green('\nOK Region policy config updated.\n'));
    });

  policy
    .command('preflight <intent>')
    .description('Run region-aware preflight checks for an intended action')
    .option('--action <action>', 'Optional explicit internal action name')
    .option('--json', 'Output JSON')
    .action((intent, options) => {
      const action = String(options.action || parseIntent(intent)).trim();
      const report = preflightFor({
        action,
        region: config.getRegionConfig()
      });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(chalk.bold('\nPolicy Preflight'));
      console.log(chalk.gray(`  action: ${report.action}`));
      console.log(chalk.gray(`  pack: ${report.pack}`));
      console.log(chalk.gray(`  mode: ${report.mode}`));
      console.log(chalk.gray(`  country: ${report.country || '(not set)'}`));
      console.log(chalk.gray(`  timezone: ${report.timezone || '(not set)'}`));
      console.log('');
      report.checks.forEach((c) => {
        const sev = String(c.severity || 'info').toUpperCase();
        const color = sev === 'BLOCK' ? chalk.red : sev === 'WARN' ? chalk.yellow : chalk.cyan;
        console.log(`- ${color(sev)} ${c.ok ? chalk.green('OK') : chalk.gray('CHECK')} ${c.message}`);
      });
      console.log('');
      if (!report.ok) {
        console.log(chalk.red('Result: blocked by policy.\n'));
      } else if (report.summary.warnings > 0) {
        console.log(chalk.yellow('Result: proceed with caution.\n'));
      } else {
        console.log(chalk.green('Result: clear to proceed.\n'));
      }
    });
}

module.exports = registerPolicyCommands;
