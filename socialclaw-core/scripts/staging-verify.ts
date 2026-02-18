import fs from 'node:fs';
import path from 'node:path';

function getEnv(name: string, fallback = ''): string {
  const v = String(process.env[name] || '').trim();
  return v || fallback;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function renderProviderSection(name: string, provider: Record<string, unknown>): string[] {
  const after = (provider.after || {}) as Record<string, unknown>;
  const contract = (after.contract || {}) as Record<string, unknown>;
  const verification = (provider.verification || {}) as Record<string, unknown>;
  const verificationBody = (verification.verification || {}) as Record<string, unknown>;
  const checks = asArray<Record<string, unknown>>(verificationBody.checks);
  const suggestions = asArray<Record<string, unknown>>(provider.suggestions);
  const latest = (after.latestVerification || {}) as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(`## ${name}`);
  lines.push(`- ready: ${Boolean(contract.ready)}`);
  lines.push(`- connected: ${Boolean(contract.connected)}`);
  lines.push(`- verified: ${Boolean(contract.verified)}`);
  lines.push(`- testSendPassed: ${Boolean(contract.testSendPassed)}`);
  lines.push(`- stale: ${Boolean(contract.stale)}`);
  lines.push(`- latestVerification: ${String(latest.createdAt || 'none')} (${String(latest.status || 'none')})`);
  lines.push('');
  lines.push('### Checks');
  if (!checks.length) lines.push('- (none)');
  checks.forEach((c) => {
    lines.push(`- ${String(c.key || 'check')}: ${Boolean(c.ok)} - ${String(c.detail || '')}`);
  });
  lines.push('');
  lines.push('### Suggestions');
  if (!suggestions.length) lines.push('- (none)');
  suggestions.slice(0, 5).forEach((s) => {
    lines.push(`- ${String(s.title || s.id || 'suggestion')}: ${String(s.action || '')}`);
  });
  lines.push('');
  return lines;
}

function renderMarkdown(report: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push('# SocialClaw Staging Verification Report');
  lines.push('');
  lines.push(`- ranAt: ${String(report.ranAt || '')}`);
  lines.push(`- mode: ${String(report.mode || '')}`);
  lines.push(`- ok: ${Boolean(report.ok)}`);
  lines.push(`- statusCode: ${Number(report.statusCode || 0)}`);
  lines.push(`- clientId: ${String(((report.request || {}) as Record<string, unknown>).clientId || '')}`);
  lines.push('');
  const response = (report.response || {}) as Record<string, unknown>;
  const providers = (response.providers || {}) as Record<string, unknown>;
  const wa = (providers.whatsapp || {}) as Record<string, unknown>;
  const email = (providers.email_sendgrid || {}) as Record<string, unknown>;
  lines.push(...renderProviderSection('WhatsApp', wa));
  lines.push(...renderProviderSection('Email (SendGrid)', email));
  return lines.join('\n');
}

async function main() {
  const baseUrl = getEnv('SOCIALCLAW_API_BASE', 'http://127.0.0.1:8080');
  const token = getEnv('SOCIALCLAW_BEARER');
  const clientId = getEnv('SOCIALCLAW_CLIENT_ID');
  const mode = (getEnv('SOCIALCLAW_VERIFY_MODE', 'dry_run') === 'live') ? 'live' : 'dry_run';
  const whatsappTestRecipient = getEnv('SOCIALCLAW_WA_TEST_RECIPIENT');
  const emailTestRecipient = getEnv('SOCIALCLAW_EMAIL_TEST_RECIPIENT');

  if (!token || !clientId || !whatsappTestRecipient || !emailTestRecipient) {
    throw new Error('Missing required env: SOCIALCLAW_BEARER, SOCIALCLAW_CLIENT_ID, SOCIALCLAW_WA_TEST_RECIPIENT, SOCIALCLAW_EMAIL_TEST_RECIPIENT');
  }

  const body = {
    mode,
    whatsappTestRecipient,
    whatsappTemplate: getEnv('SOCIALCLAW_WA_TEMPLATE', 'hello_world'),
    whatsappLanguage: getEnv('SOCIALCLAW_WA_LANGUAGE', 'en_US'),
    emailTestRecipient,
    emailSubject: getEnv('SOCIALCLAW_EMAIL_SUBJECT', 'SocialClaw Staging Verification'),
    emailText: getEnv('SOCIALCLAW_EMAIL_TEXT', 'Staging verification test from SocialClaw.')
  };

  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/clients/${encodeURIComponent(clientId)}/credentials/diagnose/all`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const payload = await res.json().catch(() => ({}));
  const report = {
    ranAt: new Date().toISOString(),
    mode,
    ok: Boolean(payload && payload.ok),
    statusCode: res.status,
    request: {
      clientId,
      mode,
      whatsappTestRecipient,
      emailTestRecipient
    },
    response: payload
  };

  const outDir = path.resolve(process.cwd(), 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outJsonPath = path.join(outDir, `staging-verification-${clientId}-${stamp}.json`);
  const outMdPath = path.join(outDir, `staging-verification-${clientId}-${stamp}.md`);
  fs.writeFileSync(outJsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(outMdPath, renderMarkdown(report as unknown as Record<string, unknown>), 'utf8');

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: report.ok, statusCode: res.status, reportJsonPath: outJsonPath, reportMdPath: outMdPath }, null, 2));
  if (!res.ok || !report.ok) process.exitCode = 1;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error && (error as Error).message ? (error as Error).message : String(error));
  process.exit(1);
});
