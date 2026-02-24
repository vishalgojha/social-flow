# social-cli

A command-line and localhost control plane for Meta APIs (Facebook, Instagram, WhatsApp, and Marketing API).

Built for developers and agencies that want one consistent workflow for auth, posting, analytics, and guarded automation.

## Why Use Social CLI

- One auth surface across Meta APIs
- Profile-based multi-account workflows
- Deterministic commands for posting/querying/marketing
- Agent + chat workflows with risk-aware execution
- Localhost API gateway (`social gateway`) with live session events
- Ops control-plane commands for approvals, invites, handoff, and runbooks

## Install

### npm (recommended)

```bash
npm install -g @vishalgojha/social-cli
social --help
```

### One-click installer (Windows, from repo)

1. Open the repo locally.
2. Double-click `install.cmd`.
3. After install, choose guided setup (`Y`) to run auth and launch the gateway.

What installer does:

- installs dependencies
- builds required targets
- links global `social` command (with fallback)
- verifies CLI health

## Quick Start

```bash
# 1) Authenticate
social auth login -a facebook

# 2) Check setup health
social doctor

# 3) Query test
social query me --api facebook

# 4) Start gateway
social gateway
```

If `social` is not recognized in your current terminal, open a new terminal and retry.

## Core Commands

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

## Docs Index

- Fast walkthrough: `QUICKSTART.md`
- Example commands: `EXAMPLES.md`
- AI interface details: `docs/AI_INTERFACE.md`
- Chat agent details: `docs/CHAT_AGENT.md`
- Gateway API details: `docs/GATEWAY_UI.md`
- Contributor guide: `CONTRIBUTING.md`
- Publish/release maintainer flow: `SETUP_AND_PUBLISHING.md`

## Troubleshooting (Quick)

### `social` command not found

- Open a fresh terminal after install.
- Run local CLI directly from repo root:

```powershell
node .\bin\social.js --help
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
- Use repo-local execution (`node .\bin\social.js ...`) instead of global link.

## Safety Notes

High-risk operations (campaign mutation, budget updates, bulk sends, etc.) should be reviewed before execution. Use:

- `social doctor`
- plan-first flows in `social ai` / `social agent`
- approvals in `social ops` for team workflows

## License

MIT - see `LICENSE`.
