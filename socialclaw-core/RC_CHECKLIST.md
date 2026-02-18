# SocialClaw Release Candidate Checklist

## Build and Test
- [ ] `npm ci` completes in `socialclaw-core/`
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes

## Runtime Validation
- [ ] PostgreSQL schema applied from `src/db/schema.sql`
- [ ] Redis connectivity verified
- [ ] API process starts (`npm run dev`)
- [ ] Worker process starts (`npm run worker:dev`)
- [ ] `/health` and `/metrics` respond

## Security Controls
- [x] RBAC middleware for owner/admin/operator/viewer
- [x] API rate limiting + helmet
- [x] Input sanitization on workflow intent
- [x] Credential encryption at rest (AES-256-GCM)
- [x] Credential rotation endpoint
- [ ] Secrets sourced from vault/secret manager (not `.env` in production)
- [ ] External security review / penetration test

## Deterministic Execution
- [x] Approved-only workflow execution path
- [x] Deterministic node runner (`trigger`, `condition`, `delay`, `action`)
- [x] Safety cap enforcement
- [x] Retry/backoff queue policy
- [x] Execution replay timeline endpoint
- [x] Graph-edge branching (`next` pointers / conditional jumps)
- [x] Idempotency keys enforced per action at DB level

## Integrations
- [x] WhatsApp action adapter scaffold with dry-run safety
- [x] Verification evidence logging and status contract endpoint
- [x] One-click diagnostics endpoint with fix suggestions
- [ ] Live WhatsApp send validation in staging with test number
- [ ] Production email provider adapter (SES/SendGrid)
- [ ] CRM adapter integration against selected provider

## Operations
- [x] Dockerfiles for API and worker
- [x] Kubernetes manifests for API/worker/data/nginx
- [x] GitHub Actions CI scaffold
- [ ] SLOs, alert routing, and on-call runbook
- [ ] Backup/restore drill for Postgres
- [ ] Disaster recovery playbook
