import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function getEnv(name: string, fallback = ''): string {
  const v = String(process.env[name] || '').trim();
  return v || fallback;
}

function latestReportPath(clientId: string): string {
  const reportsDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) throw new Error(`Reports dir not found: ${reportsDir}`);
  const rows = fs.readdirSync(reportsDir)
    .filter((x) => x.startsWith(`staging-verification-${clientId}-`) && (x.endsWith('.md') || x.endsWith('.json')))
    .map((x) => ({
      file: path.join(reportsDir, x),
      mtime: fs.statSync(path.join(reportsDir, x)).mtimeMs,
      isMd: x.endsWith('.md')
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!rows.length) throw new Error(`No report files found for client ${clientId}`);
  const md = rows.find((x) => x.isMd);
  return (md || rows[0]).file;
}

async function main() {
  const baseUrl = getEnv('SOCIALCLAW_API_BASE', 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const token = getEnv('SOCIALCLAW_BEARER');
  const clientId = getEnv('SOCIALCLAW_CLIENT_ID');
  const releaseTag = getEnv('SOCIALCLAW_RELEASE_TAG');
  const reportPathInput = getEnv('SOCIALCLAW_REPORT_PATH');
  const notes = getEnv('SOCIALCLAW_RELEASE_NOTES', 'Release signoff from CLI helper');

  if (!token || !clientId || !releaseTag) {
    throw new Error('Missing required env: SOCIALCLAW_BEARER, SOCIALCLAW_CLIENT_ID, SOCIALCLAW_RELEASE_TAG');
  }

  const reportPath = reportPathInput ? path.resolve(reportPathInput) : latestReportPath(clientId);
  if (!fs.existsSync(reportPath)) throw new Error(`Report file not found: ${reportPath}`);

  const content = fs.readFileSync(reportPath);
  const sha256 = createHash('sha256').update(content).digest('hex');

  const res = await fetch(`${baseUrl}/v1/releases/signoff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      clientId,
      releaseTag,
      reportSha256: sha256,
      reportPath,
      status: 'approved',
      notes,
      metadata: {
        source: 'scripts/release-signoff.ts',
        reportSizeBytes: content.byteLength
      }
    })
  });

  const payload = await res.json().catch(() => ({}));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: res.ok, statusCode: res.status, reportPath, sha256, signoff: payload.signoff || null }, null, 2));
  if (!res.ok) process.exitCode = 1;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error && (error as Error).message ? (error as Error).message : String(error));
  process.exit(1);
});
