import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { workflowExecutionCounter, workflowLatencyHistogram } from '../observability/metrics';
import { logger } from '../observability/logger';
import { appendExecutionEvent } from '../services/repository';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

async function execute(job: Job): Promise<void> {
  const started = Date.now();
  const payload = job.data as {
    executionId: string;
    tenantId: string;
    workflowId: string;
    workflowVersion: number;
    triggerPayload: Record<string, unknown>;
  };

  await appendExecutionEvent({
    tenantId: payload.tenantId,
    executionId: payload.executionId,
    level: 'info',
    eventType: 'execution.started',
    payload: { attempt: job.attemptsStarted }
  });

  // TODO: replace with deterministic node traversal engine.
  if (payload.triggerPayload && payload.triggerPayload['forceFail']) {
    throw new Error('forced_execution_failure');
  }

  await appendExecutionEvent({
    tenantId: payload.tenantId,
    executionId: payload.executionId,
    level: 'info',
    eventType: 'execution.completed',
    payload: { result: 'ok' }
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
      await appendExecutionEvent({
        tenantId: data.tenantId,
        executionId: data.executionId,
        level: 'error',
        eventType: 'execution.failed',
        payload: { message: String(err?.message || 'unknown_error') }
      });
    }
  });
