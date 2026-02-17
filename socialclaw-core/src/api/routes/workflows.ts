import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { assertRole } from '../../security/rbac';
import { sanitizeText } from '../../security/input';
import { generateWorkflowDraft } from '../../ai/generator';
import { validateWorkflow } from '../../workflows/schema';
import { saveWorkflowDraft, approveWorkflow } from '../../services/repository';

export function registerWorkflowRoutes(app: FastifyInstance) {
  app.post('/v1/workflows/draft', {
    schema: {
      body: {
        type: 'object',
        required: ['clientId', 'intent'],
        properties: { clientId: { type: 'string' }, intent: { type: 'string' } }
      }
    }
  }, async (req, reply) => {
    assertRole(req.user!.role, 'operator');
    const body = req.body as { clientId: string; intent: string };
    const intent = sanitizeText(body.intent);
    if (!intent) return reply.code(422).send({ error: 'intent_required' });
    const workflow = await generateWorkflowDraft({
      tenantId: req.user!.tenantId,
      clientId: body.clientId,
      intent,
      createdBy: req.user!.userId
    });
    workflow.id = workflow.id || randomUUID();
    const check = validateWorkflow(workflow);
    if (!check.ok) return reply.code(422).send({ error: 'invalid_workflow', details: check.errors });
    const saved = await saveWorkflowDraft(workflow);
    return { workflowId: saved.workflowId, version: saved.version, workflow };
  });

  app.post('/v1/workflows/:workflowId/approve', {
    schema: {
      body: {
        type: 'object',
        properties: { reason: { type: 'string' } }
      }
    }
  }, async (req) => {
    assertRole(req.user!.role, 'admin');
    const params = req.params as { workflowId: string };
    const body = req.body as { reason?: string };
    await approveWorkflow({
      workflowId: params.workflowId,
      tenantId: req.user!.tenantId,
      approvedBy: req.user!.userId,
      reason: body.reason || 'approved_from_api'
    });
    return { approved: true, workflowId: params.workflowId };
  });
}
