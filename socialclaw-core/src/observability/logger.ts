import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  base: undefined,
  redact: ['req.headers.authorization', 'password', 'token', '*.secret']
});
