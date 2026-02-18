import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  ENCRYPTION_KEY: z.string().min(16).default('dev-only-change-me'),
  EXECUTION_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => (String(v || 'true').toLowerCase() !== 'false')),
  VERIFY_ALLOW_LIVE: z
    .string()
    .optional()
    .transform((v) => (String(v || 'false').toLowerCase() === 'true')),
  WHATSAPP_VERIFICATION_MAX_AGE_DAYS: z.coerce.number().default(30),
  EMAIL_VERIFICATION_MAX_AGE_DAYS: z.coerce.number().default(30),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  SENTRY_DSN: z.string().optional()
});

export const env = schema.parse(process.env);
