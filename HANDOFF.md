# Handoff - 2026-02-24

## Summary

This handoff captures the current TypeScript migration status and release readiness for `social-flow`.

## Update - 2026-03-01

### Product Positioning + Surface Update

- Product language was shifted from "CLI tool" to "Meta Operations Control Plane".
- Messaging now frames Social Flow as multi-surface:
  - CLI + chat/tui
  - gateway APIs/WebSocket
  - SDK integration
- README, command help text, and package description were updated accordingly.

### Ads Operations: Poor-Ad Diagnosis Command

- Added a new command:
  - `social marketing diagnose-poor-ads [adAccountId]`
- Command behavior:
  - pulls ad-level insights
  - computes median-based baselines for CTR/CPC/CPM
  - flags likely underperformers using configurable thresholds
  - ranks by severity and reports `spend_at_risk_estimate`
  - returns recommended next actions per ad
- Added examples in global help and README.

### Bundled Studio Frontend Removal (Explicit)

- Deleted bundled frontend assets:
  - `assets/studio/*`
- Gateway root (`/`) no longer serves UI and now returns disabled/deprecated response.
- `social studio` command now opens:
  - external frontend if provided, or
  - gateway status endpoint (`/api/status?doctor=1`)
- Help/docs strings were updated to remove bundled Studio UI claims.

### Files Touched in This Update

- `commands/marketing.ts`
- `bin/social.ts`
- `commands/studio.ts`
- `commands/start.ts`
- `commands/explain.ts`
- `src-runtime/commands/gateway.ts`
- `lib/gateway/server.ts`
- `README.md`
- `package.json`
- generated runtime build artifact: `dist-runtime/commands/gateway.js`

### Validation Run

- `npm run build:runtime-ts` -> pass
- `npm run build:legacy-ts` -> pass
- `node bin/social.js --help` -> updated positioning/help verified
- `node bin/social.js marketing diagnose-poor-ads --help` -> command available
- fresh gateway test on new port:
  - `/` returns disabled response
  - `/api/status?doctor=1` returns status JSON

## What Was Completed

1. Runtime TS command migration and loader routing.
2. Tooling/test runner migration to TypeScript.
3. JS migration guard and baseline enforcement.

## Runtime Command Migration

Migrated from `commands/*.js` to `src-runtime/commands/*.ts` and compiled to `dist-runtime/commands/*.js`:

- `auth`, `app`
- `query`, `limits`
- `post`, `utils`
- `whatsapp`, `instagram`
- `agent`, `tui`
- `chat`, `gateway`

Legacy JS files for the above command modules were removed from `commands/`.

`bin/social.js` now uses `loadCommandModule(name)` for migrated commands:

- Prefer `dist-runtime/commands/<name>.js`
- Fallback to `commands/<name>.js` (for not-yet-migrated modules)

## Tooling Migration

- `test/run.js` -> `test/run.ts`
- `scripts/release-smoke.js` -> `scripts/release-smoke.ts`
- Added TS build configs:
  - `tsconfig.runtime.json`
  - `tsconfig.tooling.json`
- Added migration docs:
  - `docs/TYPESCRIPT_MIGRATION.md`

## Migration Guard

- Added guard script: `scripts/ts-migration-guard.js`
- Baseline file: `scripts/ts-migration-baseline.json`
- Current baseline: `max_js_files = 70`

## Validation Status

All checks are passing at handoff time:

- `npm run build:runtime-ts` -> pass
- `node scripts/ts-migration-guard.js` -> pass (`70/70`)
- `npm run quality:check` -> pass
- `npm test` -> pass (`88 pass, 0 fail`)

## Remaining JS Command Modules

Still in `commands/`:

- `accounts.js`
- `ai.js`
- `batch.js`
- `doctor.js`
- `hub.js`
- `integrations.js`
- `marketing.js`
- `onboard.js`
- `ops.js`
- `policy.js`

## Recommended Next Steps

1. Continue migrating remaining `commands/*.js` modules in pairs and reduce baseline by 2 each batch.
2. After command migration completes, remove runtime fallback path to `commands/` in `bin/social.js`.
3. Keep `quality:check` and `npm test` green after each migration batch.

## Product Roadmap To 9/10 (Added 2026-02-26)

Priority order for reducing friction and improving beginner usability across terminal + frontend:

1. One true entrypoint (`social start-here`) that completes provider + API key + model + token + health in one guided flow.
2. Conversation-first operation by default; commands should be optional, not required.
3. Always show 1-3 next best actions after every response.
4. Unstuck state machine: no phase lock, no shortcut collisions, clear cancel/back behavior.
5. Complete domain skills: `facebook`, `instagram`, `waba`, `marketing`, `setup-auth`.
6. Human-readable error translation with exact fix commands.
7. Dry-run and approval UX before mutating actions.
8. Studio parity with terminal readiness and guided flows.
9. Friction telemetry: capture top setup/intent drop-off points weekly.
10. Golden-path E2E release hardening: new user to first successful action.
