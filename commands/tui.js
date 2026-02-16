const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const chalk = require('chalk');

function runSubprocess(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`TUI exited with code ${code}`));
    });
  });
}

function registerTuiCommand(program) {
  program
    .command('tui')
    .alias('hatch')
    .description('Launch agentic terminal UI (chat-first control plane)')
    .option('--ai-provider <provider>', 'deterministic|ollama|openai', 'deterministic')
    .option('--ai-model <model>', 'AI model override')
    .option('--ai-base-url <url>', 'AI base URL override')
    .option('--ai-api-key <key>', 'AI API key override')
    .action(async (opts) => {
      const rootDir = path.join(__dirname, '..');
      const distEntry = path.join(rootDir, 'tools', 'agentic-tui', 'dist', 'index.js');
      const srcEntry = path.join(rootDir, 'tools', 'agentic-tui', 'src', 'index.tsx');

      const env = {
        ...process.env,
        SOCIAL_TUI_AI_PROVIDER: opts.aiProvider || process.env.SOCIAL_TUI_AI_PROVIDER || '',
        SOCIAL_TUI_AI_MODEL: opts.aiModel || process.env.SOCIAL_TUI_AI_MODEL || '',
        SOCIAL_TUI_AI_BASE_URL: opts.aiBaseUrl || process.env.SOCIAL_TUI_AI_BASE_URL || '',
        SOCIAL_TUI_AI_API_KEY: opts.aiApiKey || process.env.SOCIAL_TUI_AI_API_KEY || ''
      };

      try {
        if (fs.existsSync(distEntry)) {
          await runSubprocess(process.execPath, [distEntry], env);
          return;
        }

        const tsxCli = require.resolve('tsx/dist/cli.mjs');
        await runSubprocess(process.execPath, [tsxCli, srcEntry], env);
      } catch (error) {
        console.error(chalk.red(`x Failed to start TUI: ${error.message}`));
        console.error(chalk.yellow('Build hint: npm run build:social-ts && npm --prefix tools/agentic-tui run build'));
        process.exit(1);
      }
    });
}

module.exports = registerTuiCommand;
