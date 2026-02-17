import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const workflowSchema = {
  $id: 'WorkflowDefinition',
  type: 'object',
  required: ['id', 'tenantId', 'clientId', 'name', 'version', 'status', 'triggers', 'nodes', 'actions', 'conditions', 'metadata'],
  properties: {
    id: { type: 'string', minLength: 1 },
    tenantId: { type: 'string', minLength: 1 },
    clientId: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 3 },
    version: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: ['draft', 'approved', 'archived'] },
    triggers: { type: 'array', minItems: 1, items: { type: 'string' } },
    nodes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'type', 'config'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['trigger', 'condition', 'action', 'delay'] },
          config: { type: 'object', additionalProperties: true }
        }
      }
    },
    actions: { type: 'array', minItems: 1, items: { type: 'string' } },
    conditions: { type: 'array', items: { type: 'string' } },
    metadata: {
      type: 'object',
      required: ['createdBy', 'createdAt'],
      properties: {
        createdBy: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        intent: { type: 'string' }
      }
    }
  }
} as const;

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validateFn = ajv.compile(workflowSchema);

export function validateWorkflow(input: unknown): { ok: true } | { ok: false; errors: string[] } {
  const ok = validateFn(input);
  if (ok) return { ok: true };
  return {
    ok: false,
    errors: (validateFn.errors || []).map((x) => `${x.instancePath || '/'} ${x.message || 'invalid'}`)
  };
}
