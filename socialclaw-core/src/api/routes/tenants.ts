import { FastifyInstance } from 'fastify';
import { assertRole } from '../../security/rbac';
import { registerTenant } from '../../services/repository';

export function registerTenantRoutes(app: FastifyInstance) {
  app.post('/v1/tenants', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'slug'],
        properties: { name: { type: 'string' }, slug: { type: 'string' } }
      }
    }
  }, async (req) => {
    assertRole(req.user!.role, 'owner');
    const body = req.body as { name: string; slug: string };
    const tenant = await registerTenant(body);
    return { tenant };
  });
}
