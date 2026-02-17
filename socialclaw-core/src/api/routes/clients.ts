import { FastifyInstance } from 'fastify';
import { assertRole } from '../../security/rbac';
import { createClientWorkspace } from '../../services/repository';

export function registerClientRoutes(app: FastifyInstance) {
  app.post('/v1/clients', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, externalRef: { type: 'string' } }
      }
    }
  }, async (req) => {
    assertRole(req.user!.role, 'admin');
    const body = req.body as { name: string; externalRef?: string };
    const client = await createClientWorkspace({
      tenantId: req.user!.tenantId,
      name: body.name,
      externalRef: body.externalRef
    });
    return { client };
  });
}
