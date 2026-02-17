import { FastifyInstance } from 'fastify';
import { assertRole } from '../../security/rbac';
import { saveCredential } from '../../services/repository';

export function registerCredentialRoutes(app: FastifyInstance) {
  app.post('/v1/clients/:clientId/credentials/whatsapp', {
    schema: {
      body: {
        type: 'object',
        required: ['accessTokenEncrypted', 'phoneNumberId'],
        properties: {
          accessTokenEncrypted: { type: 'string' },
          phoneNumberId: { type: 'string' },
          wabaId: { type: 'string' }
        }
      }
    }
  }, async (req) => {
    assertRole(req.user!.role, 'admin');
    const params = req.params as { clientId: string };
    const body = req.body as { accessTokenEncrypted: string; phoneNumberId: string; wabaId?: string };
    const out = await saveCredential({
      tenantId: req.user!.tenantId,
      clientId: params.clientId,
      provider: 'whatsapp',
      credentialType: 'access_token',
      encryptedSecret: body.accessTokenEncrypted,
      userId: req.user!.userId
    });
    return {
      credential: out,
      sampleResponse: {
        connected: true,
        verified: Boolean(body.phoneNumberId),
        testSendPassed: false
      }
    };
  });
}
