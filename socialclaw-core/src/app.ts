import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { authGuard } from './security/auth';
import { metricsRegistry } from './observability/metrics';
import { registerTenantRoutes } from './api/routes/tenants';
import { registerClientRoutes } from './api/routes/clients';
import { registerCredentialRoutes } from './api/routes/credentials';
import { registerWorkflowRoutes } from './api/routes/workflows';
import { registerExecutionRoutes } from './api/routes/executions';

export function buildApp() {
  const app = Fastify({ logger: false });

  app.register(sensible);
  app.register(helmet);
  app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.get('/health', async () => ({ ok: true }));
  app.get('/metrics', async (_, reply) => {
    reply.header('Content-Type', metricsRegistry().contentType);
    return metricsRegistry().metrics();
  });

  app.register(async (privateRoutes) => {
    privateRoutes.addHook('preHandler', authGuard);
    registerTenantRoutes(privateRoutes);
    registerClientRoutes(privateRoutes);
    registerCredentialRoutes(privateRoutes);
    registerWorkflowRoutes(privateRoutes);
    registerExecutionRoutes(privateRoutes);
  });

  return app;
}
