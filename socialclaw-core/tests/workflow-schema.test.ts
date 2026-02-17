import { validateWorkflow } from '../src/workflows/schema';

describe('workflow schema', () => {
  it('accepts valid workflow draft', () => {
    const out = validateWorkflow({
      id: 'wf_1',
      tenantId: 't1',
      clientId: 'c1',
      name: 'Cold lead reactivation',
      version: 1,
      status: 'draft',
      triggers: ['lead_inactivity_48h'],
      nodes: [{ id: 'n1', type: 'trigger', config: { event: 'lead_inactivity_48h' } }],
      actions: ['whatsapp.send_template'],
      conditions: [],
      metadata: { createdBy: 'u1', createdAt: new Date().toISOString() }
    });
    expect(out.ok).toBe(true);
  });

  it('rejects missing fields', () => {
    const out = validateWorkflow({ id: 'wf_1' });
    expect(out.ok).toBe(false);
  });
});
