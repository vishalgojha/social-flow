import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const workflowQueue = new Queue('workflow-execution', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 500,
    removeOnFail: 1000
  }
});

export interface WorkflowJobInput {
  executionId: string;
  tenantId: string;
  workflowId: string;
  workflowVersion: number;
  triggerType: string;
  triggerPayload: Record<string, unknown>;
}

export async function enqueueWorkflowExecution(job: WorkflowJobInput): Promise<void> {
  await workflowQueue.add('execute-workflow', job, {
    jobId: `${job.executionId}`
  });
}
