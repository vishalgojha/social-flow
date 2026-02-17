import client from 'prom-client';

client.collectDefaultMetrics();

export const workflowExecutionCounter = new client.Counter({
  name: 'socialclaw_workflow_executions_total',
  help: 'Workflow executions by status',
  labelNames: ['status']
});

export const workflowLatencyHistogram = new client.Histogram({
  name: 'socialclaw_workflow_execution_seconds',
  help: 'Workflow execution latency in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
});

export function metricsRegistry() {
  return client.register;
}
