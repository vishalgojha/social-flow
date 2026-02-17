import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { Role, UserContext } from '../types/domain';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserContext;
  }
}

export function authGuard(req: FastifyRequest, reply: FastifyReply): void {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    reply.code(401).send({ error: 'missing_bearer_token' });
    return;
  }
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { sub: string; tenantId: string; role: Role };
    req.user = { userId: decoded.sub, tenantId: decoded.tenantId, role: decoded.role };
  } catch {
    reply.code(401).send({ error: 'invalid_token' });
  }
}
