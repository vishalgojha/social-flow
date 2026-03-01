# Social Flow

![Social Flow Mint Logo](docs/assets/social-flow-logo-mint.svg)

Run Meta operations without chaos.

Social Flow is a guided control plane for agencies, growth teams, and account operators managing Facebook, Instagram, WhatsApp, and Ads Manager workflows. It gives you one place for setup, daily execution, approvals, reporting, and handoffs via commands, gateway APIs, and an SDK.

Built for non-developer operators first, while still being developer-friendly for automation and integration.

## What Social Flow Is Capable Of

- Guided setup and readiness checks for tokens, apps, and account access
- Daily operations across Facebook, Instagram, and WhatsApp from one command surface
- Ads Manager workflows including account discovery, campaign/ad set/ad visibility, insights, pacing checks, and guarded mutations
- Team-safe execution with approvals, invites, role-aware access, and handoff runbooks
- AI-assisted planning and chat-first workflows with confirmation before risky actions
- API/WebSocket gateway for local or remote operation
- SDK-based integration for internal tools, client portals, and automation layers

## Ads Manager, Framed for Operators

Social Flow covers everyday Ads Manager work without forcing teams to wire custom scripts or jump between tools.

- Understand account access and connected ad accounts quickly
- Check portfolio-level pacing and risk flags across multiple clients
- Pull campaign, ad set, ad, and insights data with deterministic commands
- Run high-risk changes (status/budget/create) through explicit confirmation flows

Useful starting commands:

```bash
social marketing accounts
social marketing status
social marketing portfolio --preset last_7d --target-daily 250
social marketing insights --help
```

## Can It Help Reduce Ad Costs?

Yes, by helping teams spot waste earlier and make safer optimization decisions.

- Pull ad account, campaign, ad set, and ad insights in repeatable formats
- Track pacing and spend risk across profiles before budgets drift
- Compare performance slices with breakdowns (age, gender, placement, device)
- Gate high-risk spend changes (budget/status/create) behind explicit confirmation

Starter diagnostics:

```bash
social marketing status
social marketing portfolio --preset last_7d --target-daily 250
social marketing insights --preset last_7d --level ad --breakdowns placement,device_platform --table
social marketing campaigns --status ACTIVE --table
social marketing diagnose-poor-ads --preset last_7d --top 15
```

Important: Social Flow does not automatically "optimize spend" on its own. It gives teams visibility, guardrails, and execution control so operators can reduce wasted spend with better decisions.

## Do This First

```bash
social start-here
social hatch
```

If you are running from source (developer workflow):

```bash
npm ci
npm run build
npm start
npm run quality:check
```

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

- Deploy gateway on Railway (API/WebSocket routes)
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
- Hatch conversational UI: `docs/HATCH_UI.md`
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
