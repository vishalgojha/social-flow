import { query } from '../db/client';
import { WorkflowDefinition } from '../types/domain';

export async function registerTenant(input: { name: string; slug: string }) {
  const out = await query<{ id: string; name: string; slug: string }>(
    `INSERT INTO tenants(name, slug) VALUES($1, $2) RETURNING id, name, slug`,
    [input.name, input.slug]
  );
  return out.rows[0];
}

export async function createClientWorkspace(input: { tenantId: string; name: string; externalRef?: string }) {
  const out = await query<{ id: string; tenant_id: string; name: string }>(
    `INSERT INTO clients(tenant_id, name, external_ref) VALUES($1, $2, $3) RETURNING id, tenant_id, name`,
    [input.tenantId, input.name, input.externalRef || null]
  );
  return out.rows[0];
}

export async function saveCredential(input: {
  tenantId: string;
  clientId: string;
  provider: string;
  credentialType: string;
  encryptedSecret: string;
  userId: string;
}) {
  const out = await query(
    `INSERT INTO client_credentials(tenant_id, client_id, provider, credential_type, encrypted_secret, created_by, rotated_at)
     VALUES($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (client_id, provider, credential_type)
     DO UPDATE SET encrypted_secret=EXCLUDED.encrypted_secret, rotated_at=NOW(), key_version=client_credentials.key_version+1
     RETURNING id, provider, credential_type, key_version, rotated_at`,
    [input.tenantId, input.clientId, input.provider, input.credentialType, input.encryptedSecret, input.userId]
  );
  return out.rows[0];
}

export async function saveWorkflowDraft(workflow: WorkflowDefinition) {
  const def = await query<{ id: string }>(
    `INSERT INTO workflow_definitions(tenant_id, client_id, name, status)
     VALUES($1, $2, $3, 'draft') RETURNING id`,
    [workflow.tenantId, workflow.clientId, workflow.name]
  );
  const workflowId = def.rows[0].id;
  await query(
    `INSERT INTO workflow_versions(workflow_id, tenant_id, version, definition)
     VALUES($1, $2, $3, $4::jsonb)`,
    [workflowId, workflow.tenantId, workflow.version, JSON.stringify(workflow)]
  );
  return { workflowId, version: workflow.version };
}

export async function approveWorkflow(input: { workflowId: string; tenantId: string; approvedBy: string; reason: string }) {
  await query(
    `UPDATE workflow_definitions
     SET status='approved', active_version=(
       SELECT MAX(version) FROM workflow_versions WHERE workflow_id=$1
     ), updated_at=NOW()
     WHERE id=$1 AND tenant_id=$2`,
    [input.workflowId, input.tenantId]
  );

  await query(
    `UPDATE workflow_versions
     SET approved_by=$1, approved_at=NOW()
     WHERE workflow_id=$2 AND tenant_id=$3 AND version=(
       SELECT MAX(version) FROM workflow_versions WHERE workflow_id=$2
     )`,
    [input.approvedBy, input.workflowId, input.tenantId]
  );

  await writeAudit({
    tenantId: input.tenantId,
    actorUserId: input.approvedBy,
    action: 'workflow.approve',
    resourceType: 'workflow',
    resourceId: input.workflowId,
    reason: input.reason,
    metadata: {}
  });
}

export async function writeAudit(input: {
  tenantId: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  reason: string;
  metadata: Record<string, unknown>;
}) {
  await query(
    `INSERT INTO audit_trails(tenant_id, actor_user_id, action, resource_type, resource_id, reason, metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [input.tenantId, input.actorUserId, input.action, input.resourceType, input.resourceId || null, input.reason, JSON.stringify(input.metadata)]
  );
}

export async function readExecution(executionId: string, tenantId: string) {
  const out = await query(
    `SELECT id, status, attempts, error_message, created_at, finished_at
     FROM workflow_executions WHERE id=$1 AND tenant_id=$2`,
    [executionId, tenantId]
  );
  return out.rows[0] || null;
}

export async function appendExecutionEvent(input: {
  tenantId: string;
  executionId: string;
  level: 'info' | 'warn' | 'error';
  eventType: string;
  payload: Record<string, unknown>;
}) {
  await query(
    `INSERT INTO workflow_event_logs(tenant_id, execution_id, level, event_type, payload)
     VALUES($1,$2,$3,$4,$5::jsonb)`,
    [input.tenantId, input.executionId, input.level, input.eventType, JSON.stringify(input.payload)]
  );
}
