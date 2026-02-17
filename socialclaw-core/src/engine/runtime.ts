import { createHash } from 'crypto';
import { WorkflowDefinition, WorkflowNode } from '../types/domain';

interface RuntimeInput {
  workflow: WorkflowDefinition;
  triggerType: string;
  triggerPayload: Record<string, unknown>;
  executionId: string;
  maxActions: number;
}

interface RuntimeHooks {
  onNodeEvent: (level: 'info' | 'warn' | 'error', eventType: string, payload: Record<string, unknown>) => Promise<void>;
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((acc, key) => {
      if (!acc || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[key];
    }, obj);
}

function evalCondition(node: WorkflowNode, triggerPayload: Record<string, unknown>): boolean {
  const cfg = node.config || {};
  const op = String(cfg['operator'] || 'exists').toLowerCase();
  const path = String(cfg['path'] || '');
  const left = path ? readPath(triggerPayload, path) : undefined;
  if (op === 'exists') return left !== undefined && left !== null && String(left) !== '';
  if (op === 'equals') return left === cfg['value'];
  if (op === 'not_equals') return left !== cfg['value'];
  if (op === 'is_true') return left === true;
  return false;
}

function stableId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function executeAction(node: WorkflowNode, executionId: string, triggerPayload: Record<string, unknown>) {
  const cfg = node.config || {};
  const action = String(cfg['action'] || '').trim().toLowerCase();
  if (!action) throw new Error(`invalid_action:missing_action_for_node:${node.id}`);

  if (action === 'whatsapp.send_template') {
    const to = String(cfg['to'] || readPath(triggerPayload, 'lead.phone') || '').trim();
    const template = String(cfg['template'] || '').trim();
    if (!to || !template) throw new Error(`invalid_action_payload:${node.id}:whatsapp.send_template`);
    return { action, delivered: true, providerMessageId: stableId(`${executionId}:${node.id}:${to}:${template}`) };
  }

  if (action === 'email.send') {
    const to = String(cfg['to'] || readPath(triggerPayload, 'lead.email') || '').trim();
    const template = String(cfg['template'] || '').trim();
    if (!to || !template) throw new Error(`invalid_action_payload:${node.id}:email.send`);
    return { action, delivered: true, providerMessageId: stableId(`${executionId}:${node.id}:${to}:${template}`) };
  }

  if (action === 'crm.update_status') {
    const status = String(cfg['status'] || '').trim();
    if (!status) throw new Error(`invalid_action_payload:${node.id}:crm.update_status`);
    return { action, updated: true, status };
  }

  throw new Error(`unsupported_action:${action}`);
}

export async function runDeterministicWorkflow(input: RuntimeInput, hooks: RuntimeHooks): Promise<{ actionsExecuted: number }> {
  const { workflow, triggerType, triggerPayload, executionId, maxActions } = input;
  let actionsExecuted = 0;

  for (const node of workflow.nodes) {
    await hooks.onNodeEvent('info', 'node.enter', { nodeId: node.id, nodeType: node.type });

    if (node.type === 'trigger') {
      const expected = String(node.config?.['event'] || '').trim();
      if (expected && expected !== triggerType) {
        await hooks.onNodeEvent('warn', 'node.trigger.skipped', { nodeId: node.id, expected, actual: triggerType });
        continue;
      }
      await hooks.onNodeEvent('info', 'node.trigger.matched', { nodeId: node.id, triggerType });
      continue;
    }

    if (node.type === 'condition') {
      const passed = evalCondition(node, triggerPayload);
      await hooks.onNodeEvent(passed ? 'info' : 'warn', 'node.condition.evaluated', { nodeId: node.id, passed });
      if (!passed && Boolean(node.config?.['stopOnFalse'])) {
        await hooks.onNodeEvent('warn', 'execution.stopped_by_condition', { nodeId: node.id });
        break;
      }
      continue;
    }

    if (node.type === 'delay') {
      const requestedMs = Number(node.config?.['ms'] || 0);
      const boundedMs = Math.max(0, Math.min(Number.isFinite(requestedMs) ? requestedMs : 0, 2000));
      if (boundedMs > 0) await new Promise((resolve) => setTimeout(resolve, boundedMs));
      await hooks.onNodeEvent('info', 'node.delay.completed', { nodeId: node.id, requestedMs, appliedMs: boundedMs });
      continue;
    }

    if (node.type === 'action') {
      actionsExecuted += 1;
      if (actionsExecuted > maxActions) throw new Error('execution_cap_exceeded');
      const result = executeAction(node, executionId, triggerPayload);
      await hooks.onNodeEvent('info', 'node.action.executed', { nodeId: node.id, ...result });
      continue;
    }

    throw new Error(`unsupported_node_type:${node.type}`);
  }

  return { actionsExecuted };
}
