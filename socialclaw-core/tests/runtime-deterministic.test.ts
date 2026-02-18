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
      tenantId: 't_1',
      clientId: 'c_1',
      triggerType: 'lead_inactivity_48h',
      triggerPayload: { noReply: true },
      executionId: 'exec_1',
      maxActions: 3,
      actionExecutor: async () => ({ action: 'email.send', delivered: true, dryRun: true })
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
      tenantId: 't_1',
      clientId: 'c_1',
      triggerType: 'lead_inactivity_48h',
      triggerPayload: {},
      executionId: 'exec_2',
      maxActions: 1,
      actionExecutor: async (actionInput) => {
        throw new Error(`unsupported_action:${String(actionInput.action || '')}`);
      }
    }, {
      onNodeEvent: async () => {}
    })).rejects.toThrow('unsupported_action');
  });

  it('routes by onTrue/onFalse graph edges deterministically', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf_3',
      tenantId: 't_1',
      clientId: 'c_1',
      name: 'Graph branch',
      version: 1,
      status: 'approved',
      triggers: ['lead_inactivity_48h'],
      nodes: [
        { id: 't1', type: 'trigger', config: { event: 'lead_inactivity_48h', next: 'c1' } },
        { id: 'c1', type: 'condition', config: { operator: 'is_true', path: 'vip', onTrue: 'a_vip', onFalse: 'a_regular' } },
        { id: 'a_vip', type: 'action', config: { action: 'email.send' } },
        { id: 'a_regular', type: 'action', config: { action: 'email.send' } }
      ],
      actions: ['email.send'],
      conditions: ['vip'],
      metadata: { createdBy: 'u_1', createdAt: new Date().toISOString() }
    };

    const executed: string[] = [];
    await runDeterministicWorkflow({
      workflow,
      tenantId: 't_1',
      clientId: 'c_1',
      triggerType: 'lead_inactivity_48h',
      triggerPayload: { vip: false },
      executionId: 'exec_3',
      maxActions: 3,
      actionExecutor: async (actionInput) => {
        executed.push(actionInput.nodeId);
        return { action: actionInput.action, delivered: true };
      }
    }, {
      onNodeEvent: async () => {}
    });

    expect(executed).toEqual(['a_regular']);
  });
});
