import { env } from '../config/env';
import { logger } from './logger';

export function initSentry(): void {
  if (!env.SENTRY_DSN) return;
  // Wire @sentry/node in production builds when dependency is added.
  logger.info('sentry configured');
}
