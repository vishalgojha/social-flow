export type Role = 'owner' | 'admin' | 'operator' | 'viewer';

export interface UserContext {
  userId: string;
  tenantId: string;
  role: Role;
}

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'condition' | 'action' | 'delay';
  config: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  tenantId: string;
  clientId: string;
  name: string;
  version: number;
  status: 'draft' | 'approved' | 'archived';
  triggers: string[];
  nodes: WorkflowNode[];
  actions: string[];
  conditions: string[];
  metadata: {
    createdBy: string;
    createdAt: string;
    intent?: string;
  };
}
