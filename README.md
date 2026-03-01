# Social Flow

![Social Flow Mint Logo](docs/assets/social-flow-logo-mint.svg)

An agentic operations platform for Meta APIs (Facebook, Instagram, WhatsApp, and Marketing API), with a terminal command surface, a bundled Studio UI, and an API/WebSocket gateway.

Built for developers and agencies that want one consistent system for auth, execution, analytics, and guarded automation.

## Do This First

```bash
npm ci
npm run build
npm start
npm run quality:check
railway up
```

## Why Use Social Flow

- One auth surface across Meta APIs
- Profile-based multi-account workflows
- Deterministic commands for posting/querying/marketing
- Agent + chat workflows with risk-aware execution
- Bundled Studio UI + API/WebSocket gateway (`social gateway`) for local and remote operation
- External frontend integration option using secured gateway access (`x-gateway-key`)
- Typed SDK-ready gateway routes (`/api/sdk/*`) for app integrations with guardrails
- Ops control-plane commands for approvals, invites, handoff, and runbooks

## Install

### npm (recommended)

```bash
npm install -g @vishalgojha/social-flow
social --help
```

Optional executable alias:

```bash
social-flow --help
```

### One-click installer (Windows, from repo)

1. Open the repo locally.
2. Double-click `install.cmd`.
3. After install, choose guided setup (`Y`) to run auth and launch the gateway.

What installer does:

- installs dependencies
- builds required targets
- links global `social` command (with fallback)
- verifies runtime health

## Quick Start

```bash
# 1) Unified first run (AI provider + setup + health)
social start-here

# 2) Open conversational control plane
social hatch
```

If `social` is not recognized in your current terminal, open a new terminal and retry.

## Railway + Frontend (Agentic)

- Deploy gateway on Railway (bundled Studio is available at `/` plus API/WebSocket routes)
- Set `SOCIAL_GATEWAY_API_KEY` and `SOCIAL_GATEWAY_CORS_ORIGINS`
- Connect your frontend with `x-gateway-key` header on REST and `?gatewayKey=` on `/ws`
- Optional launcher:

```bash
social studio --url https://<railway-domain> --frontend-url https://<frontend-domain>
```

## Command Surface

```bash
social auth ...        # token/app credential management
social query ...       # generic Graph API reads
social post ...        # Facebook page posting
social marketing ...   # Ads/Marketing API operations
social whatsapp ...    # WhatsApp API operations
social ai "..."        # natural-language command interface
social chat            # conversational chat agent
social agent ...       # plan/execute agent workflows
social gateway         # localhost API/WebSocket gateway
social ops ...         # agency ops workflows + reports/handoff
social hub ...         # package/connector trust + lifecycle
```

SDK endpoints for integration apps:

```bash
GET  /api/sdk/status
GET  /api/sdk/doctor
GET  /api/sdk/actions
POST /api/sdk/actions/plan
POST /api/sdk/actions/execute
```

Agency portfolio view:

```bash
social marketing portfolio --preset last_7d --target-daily 250
social marketing portfolio --targets-file ./agency-targets.json --include-missing
```

## Docs Index

- Fast walkthrough: `QUICKSTART.md`
- Example commands: `EXAMPLES.md`
- Domain skills: `skills/README.md`
- AI interface details: `docs/AI_INTERFACE.md`
- Chat agent details: `docs/CHAT_AGENT.md`
- Gateway API details: `docs/GATEWAY_UI.md`
- TypeScript SDK usage: `sdk/README.md`
- Command-surface v2 simplification map: `docs/CLI_V2_MIGRATION.md`
- Deployment runbook: `DEPLOYMENT.md`
- TypeScript migration plan: `docs/TYPESCRIPT_MIGRATION.md`
- Contributor guide: `CONTRIBUTING.md`
- Publish/release maintainer flow: `SETUP_AND_PUBLISHING.md`

## Troubleshooting (Quick)

### `social` command not found

- Open a fresh terminal after install.
- Run local CLI directly from repo root:

```powershell
node .\dist-legacy\bin\social.js --help
```

### PowerShell blocks npm scripts (`npm.ps1` policy issue)

Use `npm.cmd` in PowerShell:

```powershell
npm.cmd install
npm.cmd link
```

### `npm link` EPERM on Windows

- Run terminal as Administrator, or
- Enable Windows Developer Mode, or
- Use repo-local execution (`node .\dist-legacy\bin\social.js ...`) instead of global link.

## Safety Notes

High-risk operations (campaign mutation, budget updates, bulk sends, etc.) should be reviewed before execution. Use:

- `social doctor`
- plan-first flows in `social ai` / `social agent`
- approvals in `social ops` for team workflows

## Maintainer Release

```bash
npm run release:patch
```

Other options:

- `npm run release:minor`
- `npm run release:major`
- `npm run release:dry-run`

## License

MIT - see `LICENSE`.
