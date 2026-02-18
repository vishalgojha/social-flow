import { WorkflowDefinition, WorkflowNode } from '../types/domain';
import { executeAction } from './actions';

interface RuntimeInput {
  workflow: WorkflowDefinition;
  tenantId: string;
  clientId: string;
  triggerType: string;
  triggerPayload: Record<string, unknown>;
  executionId: string;
  maxActions: number;
  maxNodeVisits?: number;
  actionExecutor?: typeof executeAction;
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

function normalizeNextIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  const one = String(value || '').trim();
  return one ? [one] : [];
}

function sequentialNext(nodes: WorkflowNode[], nodeId: string): string[] {
  const idx = nodes.findIndex((x) => x.id === nodeId);
  if (idx < 0 || idx >= nodes.length - 1) return [];
  return [nodes[idx + 1].id];
}

export async function runDeterministicWorkflow(input: RuntimeInput, hooks: RuntimeHooks): Promise<{ actionsExecuted: number }> {
  const {
    workflow,
    tenantId,
    clientId,
    triggerType,
    triggerPayload,
    executionId,
    maxActions,
    maxNodeVisits = 500,
    actionExecutor = executeAction
  } = input;
  let actionsExecuted = 0;
  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]));
  const queue: string[] = [];
  const triggerNodes = workflow.nodes.filter((x) => x.type === 'trigger');
  if (triggerNodes.length) {
    triggerNodes.forEach((n) => queue.push(n.id));
  } else if (workflow.nodes[0]) {
    queue.push(workflow.nodes[0].id);
  }
  let visits = 0;

  while (queue.length) {
    visits += 1;
    if (visits > maxNodeVisits) throw new Error('node_visit_limit_exceeded');
    const nodeId = queue.shift() as string;
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    await hooks.onNodeEvent('info', 'node.enter', { nodeId: node.id, nodeType: node.type });

    if (node.type === 'trigger') {
      const expected = String(node.config?.['event'] || '').trim();
      if (expected && expected !== triggerType) {
        await hooks.onNodeEvent('warn', 'node.trigger.skipped', { nodeId: node.id, expected, actual: triggerType });
        continue;
      }
      await hooks.onNodeEvent('info', 'node.trigger.matched', { nodeId: node.id, triggerType });
      const next = normalizeNextIds(node.config?.['next']);
      (next.length ? next : sequentialNext(workflow.nodes, node.id)).forEach((id) => queue.push(id));
      continue;
    }

    if (node.type === 'condition') {
      const passed = evalCondition(node, triggerPayload);
      await hooks.onNodeEvent(passed ? 'info' : 'warn', 'node.condition.evaluated', { nodeId: node.id, passed });
      if (!passed && Boolean(node.config?.['stopOnFalse'])) {
        await hooks.onNodeEvent('warn', 'execution.stopped_by_condition', { nodeId: node.id });
        continue;
      }
      const routed = passed
        ? normalizeNextIds(node.config?.['onTrue'])
        : normalizeNextIds(node.config?.['onFalse']);
      (routed.length ? routed : sequentialNext(workflow.nodes, node.id)).forEach((id) => queue.push(id));
      continue;
    }

    if (node.type === 'delay') {
      const requestedMs = Number(node.config?.['ms'] || 0);
      const boundedMs = Math.max(0, Math.min(Number.isFinite(requestedMs) ? requestedMs : 0, 2000));
      if (boundedMs > 0) await new Promise((resolve) => setTimeout(resolve, boundedMs));
      await hooks.onNodeEvent('info', 'node.delay.completed', { nodeId: node.id, requestedMs, appliedMs: boundedMs });
      const next = normalizeNextIds(node.config?.['next']);
      (next.length ? next : sequentialNext(workflow.nodes, node.id)).forEach((id) => queue.push(id));
      continue;
    }

    if (node.type === 'action') {
      actionsExecuted += 1;
      if (actionsExecuted > maxActions) throw new Error('execution_cap_exceeded');
      const cfg = node.config || {};
      const result = await actionExecutor({
        nodeId: node.id,
        action: String(cfg['action'] || ''),
        config: cfg
      }, {
        executionId,
        tenantId,
        clientId,
        triggerPayload
      });
      await hooks.onNodeEvent('info', 'node.action.executed', { nodeId: node.id, ...result });
      const next = normalizeNextIds(node.config?.['next']);
      (next.length ? next : sequentialNext(workflow.nodes, node.id)).forEach((id) => queue.push(id));
      continue;
    }

    throw new Error(`unsupported_node_type:${node.type}`);
  }

  return { actionsExecuted };
}
