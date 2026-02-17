import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { WorkflowDefinition } from '../types/domain';
import { validateWorkflow } from '../workflows/schema';

const client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

export async function generateWorkflowDraft(input: {
  tenantId: string;
  clientId: string;
  intent: string;
  createdBy: string;
}): Promise<WorkflowDefinition> {
  const fallback: WorkflowDefinition = {
    id: randomUUID(),
    tenantId: input.tenantId,
    clientId: input.clientId,
    name: 'AI Draft - Lead Reactivation',
    version: 1,
    status: 'draft',
    triggers: ['lead_inactivity_48h'],
    nodes: [
      { id: 'trigger-1', type: 'trigger', config: { event: 'lead_inactivity_48h' } },
      { id: 'action-1', type: 'action', config: { channel: 'whatsapp', template: 'reactivation_v1' } },
      { id: 'delay-1', type: 'delay', config: { hours: 24 } },
      { id: 'action-2', type: 'action', config: { channel: 'email', template: 'escalation_v1' } }
    ],
    actions: ['whatsapp.send_template', 'email.send'],
    conditions: ['no_reply_after_3_followups'],
    metadata: { createdBy: input.createdBy, createdAt: new Date().toISOString(), intent: input.intent }
  };

  if (!client) {
    const check = validateWorkflow(fallback);
    if (!check.ok) throw new Error(`workflow_validation_failed:${check.errors.join(';')}`);
    return fallback;
  }

  const prompt = `Convert this intent to strict workflow JSON only: ${input.intent}`;
  const res = await client.responses.create({
    model: env.OPENAI_MODEL,
    input: prompt,
    temperature: 0.1
  });

  const content = res.output_text || '';
  const parsed = JSON.parse(content) as WorkflowDefinition;
  const check = validateWorkflow(parsed);
  if (!check.ok) throw new Error(`workflow_validation_failed:${check.errors.join(';')}`);
  return parsed;
}
