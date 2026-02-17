import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { workflowExecutionCounter, workflowLatencyHistogram } from '../observability/metrics';
import { logger } from '../observability/logger';
import {
  appendExecutionEvent,
  markExecutionFinished,
  markExecutionRunning,
  readWorkflowVersionDefinition
} from '../services/repository';
import { runDeterministicWorkflow } from './runtime';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

async function execute(job: Job): Promise<void> {
  const started = Date.now();
  const payload = job.data as {
    executionId: string;
    tenantId: string;
    workflowId: string;
    workflowVersion: number;
    triggerType: string;
    triggerPayload: Record<string, unknown>;
  };

  await markExecutionRunning({
    tenantId: payload.tenantId,
    executionId: payload.executionId,
    attempts: Number(job.attemptsStarted || 1)
  });

  await appendExecutionEvent({
    tenantId: payload.tenantId,
    executionId: payload.executionId,
    level: 'info',
    eventType: 'execution.started',
    payload: { attempt: job.attemptsStarted, triggerType: payload.triggerType }
  });

  const workflow = await readWorkflowVersionDefinition({
    tenantId: payload.tenantId,
    workflowId: payload.workflowId,
    version: payload.workflowVersion
  });
  if (!workflow) throw new Error('workflow_version_not_found');

  const out = await runDeterministicWorkflow({
    workflow,
    triggerType: payload.triggerType,
    triggerPayload: payload.triggerPayload || {},
    executionId: payload.executionId,
    maxActions: 200
  }, {
    onNodeEvent: async (level, eventType, details) => appendExecutionEvent({
      tenantId: payload.tenantId,
      executionId: payload.executionId,
      level,
      eventType,
      payload: details
    })
  });

  await appendExecutionEvent({
    tenantId: payload.tenantId,
    executionId: payload.executionId,
    level: 'info',
    eventType: 'execution.completed',
    payload: { result: 'ok', actionsExecuted: out.actionsExecuted }
  });
  await markExecutionFinished({
    tenantId: payload.tenantId,
    executionId: payload.executionId,
    status: 'succeeded'
  });

  workflowExecutionCounter.inc({ status: 'succeeded' });
  workflowLatencyHistogram.observe((Date.now() - started) / 1000);
}

new Worker(
  'workflow-execution',
  async (job) => execute(job),
  { connection, concurrency: 10 }
)
  .on('completed', (job) => {
    logger.info({ jobId: job.id }, 'workflow job completed');
  })
  .on('failed', async (job, err) => {
    const data = (job?.data || {}) as { tenantId?: string; executionId?: string };
    workflowExecutionCounter.inc({ status: 'failed' });
    logger.error({ jobId: job?.id, err: err?.message }, 'workflow job failed');
    if (data.tenantId && data.executionId) {
      const message = String(err?.message || 'unknown_error');
      const blocked = message.includes('execution_cap_exceeded') || message.includes('unsupported_action');
      await appendExecutionEvent({
        tenantId: data.tenantId,
        executionId: data.executionId,
        level: 'error',
        eventType: 'execution.failed',
        payload: { message }
      });
      await markExecutionFinished({
        tenantId: data.tenantId,
        executionId: data.executionId,
        status: blocked ? 'blocked' : 'failed',
        errorMessage: message
      });
    }
  });
