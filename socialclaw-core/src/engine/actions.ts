import { createHash } from 'crypto';
import { env } from '../config/env';
import { decryptSecret } from '../security/crypto';
import {
  completeActionIdempotency,
  getCredential,
  getLatestIntegrationVerification,
  reserveActionIdempotency
} from '../services/repository';
import { evaluateEmailContract, evaluateWhatsAppContract } from './integration-contract';

export interface ActionContext {
  executionId: string;
  tenantId: string;
  clientId: string;
  triggerPayload: Record<string, unknown>;
}

export interface ActionInput {
  nodeId: string;
  action: string;
  config: Record<string, unknown>;
}

function actionKey(input: ActionInput, ctx: ActionContext): string {
  const digest = createHash('sha1')
    .update(`${ctx.executionId}:${input.nodeId}:${String(input.action || '').trim().toLowerCase()}:${JSON.stringify(input.config || {})}`)
    .digest('hex');
  return `exec:${ctx.executionId}:${input.nodeId}:${digest}`;
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

async function whatsappAdapter(input: ActionInput, ctx: ActionContext) {
  const to = String(input.config['to'] || readPath(ctx.triggerPayload, 'lead.phone') || '').trim();
  const template = String(input.config['template'] || '').trim();
  if (!to || !template) throw new Error(`invalid_action_payload:${input.nodeId}:whatsapp.send_template`);

  if (env.EXECUTION_DRY_RUN) {
    return { action: input.action, delivered: true, dryRun: true };
  }

  const tokenRow = await getCredential({
    tenantId: ctx.tenantId,
    clientId: ctx.clientId,
    provider: 'whatsapp',
    credentialType: 'access_token'
  });
  if (!tokenRow) throw new Error('credential_missing:whatsapp.access_token');
  const phoneCredential = await getCredential({
    tenantId: ctx.tenantId,
    clientId: ctx.clientId,
    provider: 'whatsapp',
    credentialType: 'phone_number_id'
  });
  if (!phoneCredential) throw new Error('credential_missing:whatsapp.phone_number_id');
  const latestVerification = await getLatestIntegrationVerification({
    tenantId: ctx.tenantId,
    clientId: ctx.clientId,
    provider: 'whatsapp',
    checkType: 'test_send_live'
  });
  const contract = evaluateWhatsAppContract({
    hasAccessToken: true,
    hasPhoneNumberId: true,
    latestLiveVerificationOk: latestVerification?.status === 'passed',
    latestLiveVerificationAt: latestVerification?.created_at || '',
    maxAgeDays: env.WHATSAPP_VERIFICATION_MAX_AGE_DAYS
  });
  if (!contract.ready) throw new Error('integration_not_ready:whatsapp_verification_required');

  const token = decryptSecret(tokenRow.encrypted_secret);
  const phoneNumberId = String(input.config['phoneNumberId'] || decryptSecret(phoneCredential.encrypted_secret) || '').trim();
  if (!phoneNumberId) throw new Error(`invalid_action_payload:${input.nodeId}:missing_phoneNumberId`);

  const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: template, language: { code: 'en_US' } }
    })
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`whatsapp_send_failed:${res.status}`);
  return { action: input.action, delivered: true, provider: 'meta', response: body };
}

async function emailAdapter(input: ActionInput, ctx: ActionContext) {
  const to = String(input.config['to'] || readPath(ctx.triggerPayload, 'lead.email') || '').trim();
  const template = String(input.config['template'] || '').trim();
  if (!to || !template) throw new Error(`invalid_action_payload:${input.nodeId}:email.send`);
  if (env.EXECUTION_DRY_RUN) {
    return { action: input.action, delivered: true, dryRun: true };
  }

  const apiKeyRow = await getCredential({
    tenantId: ctx.tenantId,
    clientId: ctx.clientId,
    provider: 'email_sendgrid',
    credentialType: 'api_key'
  });
  if (!apiKeyRow) throw new Error('credential_missing:email_sendgrid.api_key');

  const fromRow = await getCredential({
    tenantId: ctx.tenantId,
    clientId: ctx.clientId,
    provider: 'email_sendgrid',
    credentialType: 'from_email'
  });
  if (!fromRow) throw new Error('credential_missing:email_sendgrid.from_email');

  const latestVerification = await getLatestIntegrationVerification({
    tenantId: ctx.tenantId,
    clientId: ctx.clientId,
    provider: 'email_sendgrid',
    checkType: 'test_send_live'
  });
  const contract = evaluateEmailContract({
    hasApiKey: true,
    hasFromEmail: true,
    latestLiveVerificationOk: latestVerification?.status === 'passed',
    latestLiveVerificationAt: latestVerification?.created_at || '',
    maxAgeDays: env.EMAIL_VERIFICATION_MAX_AGE_DAYS
  });
  if (!contract.ready) throw new Error('integration_not_ready:email_verification_required');

  const apiKey = decryptSecret(apiKeyRow.encrypted_secret);
  const fromEmail = decryptSecret(fromRow.encrypted_secret);
  const subject = String(input.config['subject'] || template || 'SocialClaw Notification').trim();
  const contentText = String(input.config['text'] || `Template: ${template}`).trim();
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail },
      subject,
      content: [{ type: 'text/plain', value: contentText }]
    })
  });
  if (!res.ok) throw new Error(`email_send_failed:${res.status}`);
  return { action: input.action, delivered: true, provider: 'sendgrid', statusCode: res.status };
}

async function crmAdapter(input: ActionInput) {
  const status = String(input.config['status'] || '').trim();
  if (!status) throw new Error(`invalid_action_payload:${input.nodeId}:crm.update_status`);
  return { action: input.action, updated: true, status };
}

export async function executeAction(input: ActionInput, ctx: ActionContext): Promise<Record<string, unknown>> {
  const action = String(input.action || '').trim().toLowerCase();
  if (!action) throw new Error(`invalid_action:missing_action_for_node:${input.nodeId}`);
  const key = actionKey(input, ctx);
  const reservation = await reserveActionIdempotency({
    tenantId: ctx.tenantId,
    executionId: ctx.executionId,
    nodeId: input.nodeId,
    actionKey: key,
    requestPayload: { action, config: input.config || {} }
  });
  if (!reservation.reserved) {
    if (reservation.status === 'executed' && reservation.responsePayload) return reservation.responsePayload;
    if (reservation.status === 'in_progress') {
      return { action, skipped: true, reason: 'idempotency_in_progress' };
    }
    if (reservation.status === 'failed') {
      throw new Error(`idempotency_prior_failure:${reservation.errorMessage || action}`);
    }
  }

  try {
    let out: Record<string, unknown>;
    if (action === 'whatsapp.send_template') out = await whatsappAdapter(input, ctx);
    else if (action === 'email.send') out = await emailAdapter(input, ctx);
    else if (action === 'crm.update_status') out = await crmAdapter(input);
    else throw new Error(`unsupported_action:${action}`);

    await completeActionIdempotency({
      tenantId: ctx.tenantId,
      actionKey: key,
      status: 'executed',
      responsePayload: out
    });
    return out;
  } catch (error) {
    await completeActionIdempotency({
      tenantId: ctx.tenantId,
      actionKey: key,
      status: 'failed',
      errorMessage: String((error as Error)?.message || error || '')
    });
    throw error;
  }
}
