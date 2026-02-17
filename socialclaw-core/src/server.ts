import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './observability/logger';
import { initSentry } from './observability/sentry';

async function main() {
  initSentry();
  const app = buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'socialclaw api started');
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
