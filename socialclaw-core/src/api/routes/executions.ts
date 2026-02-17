import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { assertRole } from '../../security/rbac';
import { enqueueWorkflowExecution } from '../../engine/queue';
import { query } from '../../db/client';
import { readExecution, readExecutionTimeline, resolveApprovedWorkflowVersion } from '../../services/repository';
import { enforceSafetyLimits } from '../../engine/safety';

export function registerExecutionRoutes(app: FastifyInstance) {
  app.post('/v1/workflows/:workflowId/execute', {
    schema: {
      body: {
        type: 'object',
        required: ['clientId', 'triggerType'],
        properties: {
          clientId: { type: 'string' },
          triggerType: { type: 'string' },
          triggerPayload: { type: 'object', additionalProperties: true },
          requestedActions: { type: 'number' }
        }
      }
    }
  }, async (req) => {
    assertRole(req.user!.role, 'operator');
    const params = req.params as { workflowId: string };
    const body = req.body as {
      clientId: string;
      triggerType: string;
      triggerPayload?: Record<string, unknown>;
      requestedActions?: number;
    };

    enforceSafetyLimits({ maxActions: 200, pendingApprovals: 0, requestedActions: Number(body.requestedActions || 1) });
    const workflowVersion = await resolveApprovedWorkflowVersion({
      tenantId: req.user!.tenantId,
      workflowId: params.workflowId
    });

    const executionId = randomUUID();
    await query(
      `INSERT INTO workflow_executions(id, tenant_id, client_id, workflow_id, workflow_version, trigger_type, trigger_payload, status)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'queued')`,
      [executionId, req.user!.tenantId, body.clientId, params.workflowId, workflowVersion, body.triggerType, JSON.stringify(body.triggerPayload || {})]
    );

    await enqueueWorkflowExecution({
      executionId,
      tenantId: req.user!.tenantId,
      workflowId: params.workflowId,
      workflowVersion,
      triggerType: body.triggerType,
      triggerPayload: body.triggerPayload || {}
    });

    return { executionId, status: 'queued', workflowVersion };
  });

  app.get('/v1/executions/:executionId', async (req) => {
    assertRole(req.user!.role, 'viewer');
    const params = req.params as { executionId: string };
    const row = await readExecution(params.executionId, req.user!.tenantId);
    return { execution: row };
  });

  app.get('/v1/executions/:executionId/replay', async (req) => {
    assertRole(req.user!.role, 'viewer');
    const params = req.params as { executionId: string };
    const execution = await readExecution(params.executionId, req.user!.tenantId);
    const timeline = await readExecutionTimeline(params.executionId, req.user!.tenantId);
    return { execution, timeline };
  });
}
