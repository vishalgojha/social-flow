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

export async function getCredential(input: {
  tenantId: string;
  clientId: string;
  provider: string;
  credentialType: string;
}) {
  const out = await query<{
    id: string;
    encrypted_secret: string;
    key_version: number;
    rotated_at: string | null;
  }>(
    `SELECT id, encrypted_secret, key_version, rotated_at
     FROM client_credentials
     WHERE tenant_id=$1 AND client_id=$2 AND provider=$3 AND credential_type=$4`,
    [input.tenantId, input.clientId, input.provider, input.credentialType]
  );
  return out.rows[0] || null;
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

export async function readExecutionTimeline(executionId: string, tenantId: string) {
  const out = await query(
    `SELECT level, event_type, payload, created_at
     FROM workflow_event_logs
     WHERE execution_id=$1 AND tenant_id=$2
     ORDER BY created_at ASC`,
    [executionId, tenantId]
  );
  return out.rows;
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

export async function resolveApprovedWorkflowVersion(input: { tenantId: string; workflowId: string }) {
  const out = await query<{ active_version: number | null; status: string }>(
    `SELECT active_version, status
     FROM workflow_definitions
     WHERE id=$1 AND tenant_id=$2`,
    [input.workflowId, input.tenantId]
  );
  const row = out.rows[0];
  if (!row) throw new Error('workflow_not_found');
  if (row.status !== 'approved') throw new Error('workflow_not_approved');
  if (!Number.isFinite(Number(row.active_version || 0)) || Number(row.active_version || 0) < 1) {
    throw new Error('workflow_missing_active_version');
  }
  return Number(row.active_version);
}

export async function readWorkflowVersionDefinition(input: { tenantId: string; workflowId: string; version: number }) {
  const out = await query<{ definition: WorkflowDefinition }>(
    `SELECT definition
     FROM workflow_versions
     WHERE workflow_id=$1 AND tenant_id=$2 AND version=$3`,
    [input.workflowId, input.tenantId, input.version]
  );
  return out.rows[0]?.definition || null;
}

export async function markExecutionRunning(input: { tenantId: string; executionId: string; attempts: number }) {
  await query(
    `UPDATE workflow_executions
     SET status='running', started_at=COALESCE(started_at, NOW()), attempts=$3
     WHERE id=$1 AND tenant_id=$2`,
    [input.executionId, input.tenantId, input.attempts]
  );
}

export async function markExecutionFinished(input: {
  tenantId: string;
  executionId: string;
  status: 'succeeded' | 'failed' | 'blocked';
  errorMessage?: string;
}) {
  await query(
    `UPDATE workflow_executions
     SET status=$3, finished_at=NOW(), error_message=$4
     WHERE id=$1 AND tenant_id=$2`,
    [input.executionId, input.tenantId, input.status, input.errorMessage || null]
  );
}

export async function reserveActionIdempotency(input: {
  tenantId: string;
  executionId: string;
  nodeId: string;
  actionKey: string;
  requestPayload: Record<string, unknown>;
}) {
  const inserted = await query<{ id: string }>(
    `INSERT INTO workflow_action_idempotency(tenant_id, execution_id, node_id, action_key, status, request_payload)
     VALUES($1,$2,$3,$4,'in_progress',$5::jsonb)
     ON CONFLICT (tenant_id, action_key) DO NOTHING
     RETURNING id`,
    [input.tenantId, input.executionId, input.nodeId, input.actionKey, JSON.stringify(input.requestPayload || {})]
  );
  if (inserted.rows[0]) {
    return { reserved: true, status: 'in_progress' as const, responsePayload: null as Record<string, unknown> | null };
  }

  const existing = await query<{
    status: 'in_progress' | 'executed' | 'failed';
    response_payload: Record<string, unknown>;
    error_message: string | null;
  }>(
    `SELECT status, response_payload, error_message
     FROM workflow_action_idempotency
     WHERE tenant_id=$1 AND action_key=$2`,
    [input.tenantId, input.actionKey]
  );
  const row = existing.rows[0];
  if (!row) {
    return { reserved: false, status: 'failed' as const, responsePayload: null as Record<string, unknown> | null, errorMessage: 'idempotency_lookup_failed' };
  }
  return {
    reserved: false,
    status: row.status,
    responsePayload: row.response_payload || null,
    errorMessage: row.error_message || ''
  };
}

export async function completeActionIdempotency(input: {
  tenantId: string;
  actionKey: string;
  status: 'executed' | 'failed';
  responsePayload?: Record<string, unknown>;
  errorMessage?: string;
}) {
  await query(
    `UPDATE workflow_action_idempotency
     SET status=$3, response_payload=$4::jsonb, error_message=$5, updated_at=NOW()
     WHERE tenant_id=$1 AND action_key=$2`,
    [
      input.tenantId,
      input.actionKey,
      input.status,
      JSON.stringify(input.responsePayload || {}),
      input.errorMessage || null
    ]
  );
}
