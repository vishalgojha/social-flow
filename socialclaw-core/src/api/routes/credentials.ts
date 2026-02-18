import { FastifyInstance } from 'fastify';
import { assertRole } from '../../security/rbac';
import { env } from '../../config/env';
import {
  appendIntegrationVerification,
  getCredential,
  getLatestIntegrationVerification,
  saveCredential
} from '../../services/repository';
import { decryptSecret, encryptSecret } from '../../security/crypto';
import { buildWhatsAppFixSuggestions, evaluateWhatsAppContract } from '../../engine/integration-contract';

async function whatsappStatus(tenantId: string, clientId: string) {
  const token = await getCredential({
    tenantId,
    clientId,
    provider: 'whatsapp',
    credentialType: 'access_token'
  });
  const phone = await getCredential({
    tenantId,
    clientId,
    provider: 'whatsapp',
    credentialType: 'phone_number_id'
  });
  const latest = await getLatestIntegrationVerification({
    tenantId,
    clientId,
    provider: 'whatsapp',
    checkType: 'test_send_live'
  });
  const contract = evaluateWhatsAppContract({
    hasAccessToken: Boolean(token),
    hasPhoneNumberId: Boolean(phone),
    latestLiveVerificationOk: latest?.status === 'passed',
    latestLiveVerificationAt: latest?.created_at || '',
    maxAgeDays: env.WHATSAPP_VERIFICATION_MAX_AGE_DAYS
  });
  return { token, phone, latest, contract };
}

async function verifyWhatsApp(input: {
  tenantId: string;
  clientId: string;
  initiatedBy: string;
  testRecipient: string;
  template?: string;
  language?: string;
  mode?: 'dry_run' | 'live';
}) {
  const status = await whatsappStatus(input.tenantId, input.clientId);
  const mode = input.mode || 'dry_run';
  const checks: Array<Record<string, unknown>> = [
    { key: 'connected', ok: Boolean(status.token), detail: status.token ? 'Access token present.' : 'Missing WhatsApp access token.' },
    { key: 'verified', ok: Boolean(status.phone), detail: status.phone ? 'Phone number id present.' : 'Missing WhatsApp phone number id.' }
  ];

  let verificationStatus: 'passed' | 'failed' | 'partial' = 'failed';
  let evidence: Record<string, unknown> = { mode };

  if (!status.token || !status.phone) {
    verificationStatus = 'failed';
  } else if (mode === 'live' && !env.VERIFY_ALLOW_LIVE) {
    checks.push({
      key: 'test_send_live',
      ok: false,
      detail: 'Live verification is disabled by VERIFY_ALLOW_LIVE=false.'
    });
    verificationStatus = 'failed';
  } else if (mode === 'dry_run') {
    checks.push({
      key: 'test_send_live',
      ok: false,
      detail: 'Dry run completed. Run mode=live to satisfy test-send pass contract.'
    });
    verificationStatus = 'partial';
  } else {
    const accessToken = decryptSecret(status.token.encrypted_secret);
    const phoneNumberId = decryptSecret(status.phone.encrypted_secret);
    const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: String(input.testRecipient || '').trim(),
        type: 'template',
        template: {
          name: String(input.template || 'hello_world').trim(),
          language: { code: String(input.language || 'en_US').trim() || 'en_US' }
        }
      })
    });
    const responseBody = await res.json().catch(() => ({}));
    evidence = {
      ...evidence,
      httpStatus: res.status,
      response: responseBody
    };
    checks.push({
      key: 'test_send_live',
      ok: res.ok,
      detail: res.ok ? 'Live test-send succeeded.' : `Live test-send failed (${res.status}).`
    });
    verificationStatus = res.ok ? 'passed' : 'failed';
  }

  const row = await appendIntegrationVerification({
    tenantId: input.tenantId,
    clientId: input.clientId,
    provider: 'whatsapp',
    checkType: 'test_send_live',
    status: verificationStatus,
    checks,
    evidence,
    initiatedBy: input.initiatedBy
  });

  return {
    ok: verificationStatus === 'passed',
    verification: {
      id: row.id,
      createdAt: row.created_at,
      status: verificationStatus,
      checks,
      evidence
    }
  };
}

export function registerCredentialRoutes(app: FastifyInstance) {
  app.post('/v1/clients/:clientId/credentials/whatsapp', {
    schema: {
      body: {
        type: 'object',
        required: ['accessToken', 'phoneNumberId'],
        properties: {
          accessToken: { type: 'string' },
          phoneNumberId: { type: 'string' },
          wabaId: { type: 'string' }
        }
      }
    }
  }, async (req) => {
    assertRole(req.user!.role, 'admin');
    const params = req.params as { clientId: string };
    const body = req.body as { accessToken: string; phoneNumberId: string; wabaId?: string };
    const encryptedSecret = encryptSecret(body.accessToken);
    const out = await saveCredential({
      tenantId: req.user!.tenantId,
      clientId: params.clientId,
      provider: 'whatsapp',
      credentialType: 'access_token',
      encryptedSecret,
      userId: req.user!.userId
    });
    await saveCredential({
      tenantId: req.user!.tenantId,
      clientId: params.clientId,
      provider: 'whatsapp',
      credentialType: 'phone_number_id',
      encryptedSecret: encryptSecret(body.phoneNumberId),
      userId: req.user!.userId
    });
    if (body.wabaId) {
      await saveCredential({
        tenantId: req.user!.tenantId,
        clientId: params.clientId,
        provider: 'whatsapp',
        credentialType: 'waba_id',
        encryptedSecret: encryptSecret(body.wabaId),
        userId: req.user!.userId
      });
    }
    return {
      credential: out,
      sampleResponse: {
        connected: true,
        verified: Boolean(body.phoneNumberId),
        testSendPassed: false
      }
    };
  });

  app.post('/v1/clients/:clientId/credentials/whatsapp/rotate', {
    schema: {
      body: {
        type: 'object',
        required: ['accessToken'],
        properties: { accessToken: { type: 'string' } }
      }
    }
  }, async (req) => {
    assertRole(req.user!.role, 'admin');
    const params = req.params as { clientId: string };
    const body = req.body as { accessToken: string };
    const out = await saveCredential({
      tenantId: req.user!.tenantId,
      clientId: params.clientId,
      provider: 'whatsapp',
      credentialType: 'access_token',
      encryptedSecret: encryptSecret(body.accessToken),
      userId: req.user!.userId
    });
    return { rotated: true, credential: out };
  });

  app.get('/v1/clients/:clientId/credentials/whatsapp/status', async (req) => {
    assertRole(req.user!.role, 'viewer');
    const params = req.params as { clientId: string };
    const { latest, contract } = await whatsappStatus(req.user!.tenantId, params.clientId);
    const suggestions = buildWhatsAppFixSuggestions({
      connected: contract.connected,
      verified: contract.verified,
      testSendPassed: contract.testSendPassed,
      stale: contract.stale,
      liveAllowed: env.VERIFY_ALLOW_LIVE,
      latestVerificationStatus: latest?.status || ''
    });
    return {
      provider: 'whatsapp',
      contract,
      suggestions,
      latestVerification: latest
        ? {
            id: latest.id,
            status: latest.status,
            createdAt: latest.created_at
          }
        : null
    };
  });

  app.post('/v1/clients/:clientId/credentials/whatsapp/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['testRecipient'],
        properties: {
          testRecipient: { type: 'string' },
          template: { type: 'string' },
          language: { type: 'string' },
          mode: { type: 'string', enum: ['dry_run', 'live'] }
        }
      }
    }
  }, async (req) => {
    assertRole(req.user!.role, 'admin');
    const params = req.params as { clientId: string };
    const body = req.body as {
      testRecipient: string;
      template?: string;
      language?: string;
      mode?: 'dry_run' | 'live';
    };
    return verifyWhatsApp({
      tenantId: req.user!.tenantId,
      clientId: params.clientId,
      initiatedBy: req.user!.userId,
      testRecipient: body.testRecipient,
      template: body.template,
      language: body.language,
      mode: body.mode
    });
  });

  app.post('/v1/clients/:clientId/credentials/whatsapp/diagnose', {
    schema: {
      body: {
        type: 'object',
        required: ['testRecipient'],
        properties: {
          testRecipient: { type: 'string' },
          template: { type: 'string' },
          language: { type: 'string' },
          mode: { type: 'string', enum: ['dry_run', 'live'] }
        }
      }
    }
  }, async (req) => {
    assertRole(req.user!.role, 'admin');
    const params = req.params as { clientId: string };
    const body = req.body as {
      testRecipient: string;
      template?: string;
      language?: string;
      mode?: 'dry_run' | 'live';
    };
    const before = await whatsappStatus(req.user!.tenantId, params.clientId);
    const verification = await verifyWhatsApp({
      tenantId: req.user!.tenantId,
      clientId: params.clientId,
      initiatedBy: req.user!.userId,
      testRecipient: body.testRecipient,
      template: body.template,
      language: body.language,
      mode: body.mode || 'dry_run'
    });
    const after = await whatsappStatus(req.user!.tenantId, params.clientId);
    const suggestions = buildWhatsAppFixSuggestions({
      connected: after.contract.connected,
      verified: after.contract.verified,
      testSendPassed: after.contract.testSendPassed,
      stale: after.contract.stale,
      liveAllowed: env.VERIFY_ALLOW_LIVE,
      latestVerificationStatus: after.latest?.status || ''
    });
    return {
      ok: after.contract.ready,
      provider: 'whatsapp',
      before: {
        contract: before.contract,
        latestVerification: before.latest
          ? { id: before.latest.id, status: before.latest.status, createdAt: before.latest.created_at }
          : null
      },
      verification,
      after: {
        contract: after.contract,
        latestVerification: after.latest
          ? { id: after.latest.id, status: after.latest.status, createdAt: after.latest.created_at }
          : null
      },
      suggestions
    };
  });
}
