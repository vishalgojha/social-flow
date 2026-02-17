import { runDeterministicWorkflow } from '../src/engine/runtime';
import { WorkflowDefinition } from '../src/types/domain';

describe('deterministic runtime', () => {
  it('runs node sequence deterministically', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_1',
      tenantId: 't_1',
      clientId: 'c_1',
      name: 'Deterministic test',
      version: 1,
      status: 'approved',
      triggers: ['lead_inactivity_48h'],
      nodes: [
        { id: 'n1', type: 'trigger', config: { event: 'lead_inactivity_48h' } },
        { id: 'n2', type: 'condition', config: { operator: 'is_true', path: 'noReply', stopOnFalse: true } },
        { id: 'n3', type: 'action', config: { action: 'email.send', to: 'lead@example.com', template: 'escalation_v1' } }
      ],
      actions: ['email.send'],
      conditions: ['no_reply'],
      metadata: { createdBy: 'u_1', createdAt: new Date().toISOString() }
    };

    const events: string[] = [];
    const out = await runDeterministicWorkflow({
      workflow,
      triggerType: 'lead_inactivity_48h',
      triggerPayload: { noReply: true },
      executionId: 'exec_1',
      maxActions: 3
    }, {
      onNodeEvent: async (_, type) => { events.push(type); }
    });

    expect(out.actionsExecuted).toBe(1);
    expect(events.includes('node.action.executed')).toBe(true);
  });

  it('blocks unsupported actions', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_2',
      tenantId: 't_1',
      clientId: 'c_1',
      name: 'Unsupported action',
      version: 1,
      status: 'approved',
      triggers: ['lead_inactivity_48h'],
      nodes: [{ id: 'a1', type: 'action', config: { action: 'shell.exec' } }],
      actions: ['shell.exec'],
      conditions: [],
      metadata: { createdBy: 'u_1', createdAt: new Date().toISOString() }
    };

    await expect(runDeterministicWorkflow({
      workflow,
      triggerType: 'lead_inactivity_48h',
      triggerPayload: {},
      executionId: 'exec_2',
      maxActions: 1
    }, {
      onNodeEvent: async () => {}
    })).rejects.toThrow('unsupported_action');
  });
});
