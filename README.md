# social-cli

A social API CLI that works with Meta APIs (Facebook, Instagram, WhatsApp). For devs tired of token gymnastics.

```text
   _____            _       _      _    ____ _     ___
  / ____|          (_)     | |    | |  / ___| |   |_ _|
 | (___   ___   ___ _  __ _| | ___| | | |   | |    | |
  \___ \ / _ \ / __| |/ _` | |/ __| | | |   | |    | |
  ____) | (_) | (__| | (_| | | (__| | | |___| |___ | |
 |_____/ \___/ \___|_|\__,_|_|\___|_|  \____|_____|___|
```

Built by Chaos Craft Labs.

## What Social CLI Does

`social-cli` is a unified control plane for Meta surfaces from terminal or localhost UI.

It helps you:

- Authenticate once and manage tokens/scopes safely across Facebook, Instagram, WhatsApp, and Marketing APIs
- Run deterministic API operations (`query`, `post`, `marketing`, `whatsapp`) without writing one-off scripts
- Use profile-based multi-account workflows for agency/client setups
- Run guarded AI/agent workflows with plan-first execution and risk confirmations
- Monitor and operate through chat/TUI/web studio with logs, replay, approvals, and ops workflows

In short: instead of juggling Postman collections, scattered scripts, and manual API debugging, you get one consistent workflow with safety rails.

## Install

```bash
npm install -g @vishalgojha/social-cli
social --help
```

## Uninstall

App only (keeps local config/history):

```bash
npm uninstall -g @vishalgojha/social-cli
```

Full cleanup (remove app + local data):

```powershell
npm.cmd uninstall -g @vishalgojha/social-cli
Remove-Item -Recurse -Force "$env:USERPROFILE\.social-cli"
```

Verify removal:

```bash
social --version
```

## Local Dev + `npm link` (Windows)

If `npm link` is failing on Windows/PowerShell, use this checklist:

1. Use `npm.cmd` instead of `npm` when PowerShell blocks `.ps1` scripts.
```powershell
npm.cmd link
```
2. If you get `EPERM: operation not permitted, symlink`, enable one of:
- Run terminal as Administrator.
- Enable Windows Developer Mode (allows symlinks without elevation).
3. If linking is still blocked, run locally without linking:
```powershell
node .\bin\social.js --help
```
4. If `social` is blocked in PowerShell, run:
```powershell
social.cmd --help
```
5. Optional fix for script policy (CurrentUser scope):
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Releasing (Maintainers)

This repo includes a tag-based GitHub Actions release flow (`.github/workflows/release.yml`).

1. Add a repo secret: `NPM_TOKEN`

Create an npm automation (or granular) token with publish access for `@vishalgojha/social-cli` and add it to GitHub:

- GitHub repo: Settings -> Secrets and variables -> Actions -> New repository secret
- Name: `NPM_TOKEN`

2. Bump + tag

```bash
# bump version + update CHANGELOG.md first
git commit -am "release: v0.2.7"
git tag v0.2.7
git push origin main --tags
```

Notes:

- npm will reject re-publishing the same version (you must bump).
- The workflow verifies the tag version matches `package.json` before publishing.

## Banner / Colors

If the banner looks messy in your terminal, use the classic banner (default) or switch styles:

```bash
social --banner-style classic --help
social --banner-style slant --help
social --banner-style clean --help
social --banner-style compact --help
```

If your terminal shows no colors, force it:

```bash
social --color --help
```

## Language (MVP i18n)

CLI language can be set with:

```bash
social --lang hi doctor
```

Or globally:

```bash
setx SOCIAL_LANG hi
```

Currently supported:

- `en` (default)
- `hi`

Social Studio also supports language selection in `Settings -> Language`.

## Config Location

All config is stored here (cross-platform):

- `~/.social-cli/config.json`

This includes API version, default IDs, and tokens. The CLI never prints full tokens.

## Command Groups

- `auth`: login/app creds/debug token/scopes/status/logout
- `query`: read-only queries (me/pages/instagram-media/feed)
- `post`: create posts/photos/videos for Facebook Pages
- `instagram`: IG accounts/media/insights/comments/publish
- `whatsapp`: send messages, templates, phone numbers
- `marketing`: ads accounts, campaigns, insights (async), ad sets, creatives
- `utils`: config helpers, api version, limits
- `doctor`: quick diagnostics (sanitized config + setup hints)
- `agent`: safe planning + execution with scoped memory
- `chat`: legacy alias to `hatch` (agentic terminal chat)
- `tui`: agentic terminal dashboard (chat-style intent input + approvals + replay)
- `gateway`: localhost web UI + API gateway for chat/agent workflows
- `studio`: alias command to launch Social Studio web UI (`social studio`)
- `integrations`: guided external integrations (WABA one-click style onboarding)
- `policy`: region-aware policy config and preflight checks
- `ops`: morning operations workflow, alerts, approvals, scheduler, roles, knowledge sources
- `hub`: package hub for connectors, playbooks, and agent skills
- `accounts`: manage multiple profiles (multi-client)
- `batch`: run tool-based jobs from JSON/CSV

Run `social <group> --help` for full flags per command.

## Team Roles + Audit (Agency Friendly)

You can run Social CLI with role-based control and activity tracking per workspace.

Set active operator (used for RBAC + logs):

```bash
social ops user set vishal --name "Vishal Ojha"
social ops user show --workspace clientA
```

Assign roles:

```bash
social ops roles set alice viewer --workspace clientA
social ops roles set bob operator --workspace clientA
social ops roles show --workspace clientA --user bob
```

Track who did what:

```bash
social ops activity list --workspace clientA --limit 50
social ops activity list --workspace clientA --actor bob
```

Generate a one-file onboarding/runbook handoff for your team:

```bash
social ops handoff --workspace clientA --out ./handoff-clientA.md
social ops handoff --workspace clientA --template enterprise --out ./handoff-clientA-enterprise.md
```

## Agentic TUI

```bash
social tui
```

OpenClaw-style launcher:

```bash
social
```

This opens an interactive menu:
- Starts with `Onboard` + help when not configured
- After onboarding: auto-starts `Hatch UI` (`social hatch`)
- Use `social onboard --no-hatch` to skip auto-start

Use the top input as chat:
- `doctor`
- `status`
- `config`
- `logs limit 10`
- `replay <log-id>`
- `/ai show my profile` (uses configured Ollama/OpenAI provider)

You can run AI parsing with local Ollama models (no paid API key required) by setting provider/model in config or using TUI AI flags.

Ollama quick setup:

```bash
ollama pull qwen2.5:7b
social tui --ai-provider ollama --ai-model qwen2.5:7b --ai-base-url http://127.0.0.1:11434
```

Already have Ollama/model installed?

```bash
social tui --ai-provider ollama --ai-model <your_model_name>
```

If provider/model is already saved in config, just run:

```bash
social tui
```

Keyboard:
- `Enter`: execute/confirm
- `e`: edit slots (`key=value`)
- `a`: approve
- `r`: reject
- `d`: details

## WABA One-Click Integration (Agency/Freelancer)

Use the guided WABA flow:

```bash
social integrations connect waba --profile clientA
```

What it does:

- Opens Meta WhatsApp setup docs
- Collects token/business/WABA/phone-number inputs (auto-detect where possible)
- Runs checks (token validity, scopes when app creds exist, phone access, optional test send)
- Saves integration metadata per profile

Useful commands:

```bash
social integrations status waba --profile clientA
social integrations disconnect waba --profile clientA
social integrations disconnect waba --profile clientA --clear-token
```

## Region Policy Preflight (Global Readiness MVP)

Configure workspace region:

```bash
social policy region set --country IN --timezone Asia/Kolkata --mode strict
social policy region show
```

Run policy preflight before high-risk actions:

```bash
social policy preflight "send whatsapp promo message"
```

## Quick Start

```bash
# 1) Login (opens token page, then prompts)
social auth login --api facebook

# 1.5) Quick diagnostics (sanitized config + next-step hints)
social doctor

# 2) Query
social query me --fields id,name
social query pages --table

# 3) Pick a default Page for posting
social post pages --set-default

# 4) Post
social post create --message "Hello from social-cli"
```

## Multi-Account Profiles

Use profiles to manage multiple clients/environments (agency-friendly). Tokens/default IDs are stored per profile.

```bash
social accounts list
social accounts add clientA
social accounts switch clientA   # persists active profile

# One-off: don't persist, just run using a profile
social --profile clientA query me
```

## Batch Runner

Run a batch of tool-based jobs from a file. Jobs use the tool registry (the same safety model the agent uses).

```bash
social batch run jobs.json --concurrency 3
social batch run jobs.csv --concurrency 2 --yes
```

Example `jobs.json`:

```json
[
  { "id": "1", "profile": "clientA", "tool": "auth.status", "args": {} },
  {
    "id": "2",
    "profile": "clientA",
    "tool": "marketing.insights",
    "args": {
      "adAccountId": "act_123",
      "preset": "last_7d",
      "level": "campaign",
      "fields": "spend,impressions,clicks",
      "export": "./reports/clientA.csv",
      "append": true
    }
  }
]
```

## Marketing API (Ads)

Marketing API calls use your **Facebook token** and require permissions like:

- `ads_read` (read/list/insights)
- `ads_management` (create/update)

Many apps require **Advanced Access** for these scopes. If you get error `(#200)`, you likely need to re-auth with the right scopes and/or get app review/advanced access.

### Common pains this CLI handles

- Async insights jobs (submit, poll, then fetch results) to avoid timeouts.
- Backoff/retry on Ads throttling errors `#17` / `#32` and transient 5xx.
- Full pagination loops on list endpoints.

### Examples

```bash
# List ad accounts
social marketing accounts --table

# Set a default ad account for future commands
social marketing set-default-account act_123

# Upload an image to get image_hash
social marketing upload-image --file ./creative.png

# List campaigns
social marketing campaigns --status ACTIVE --table

# Async insights (recommended when using breakdowns)
social marketing insights --preset last_7d --level campaign --fields spend,impressions,clicks,ctr,cpc,cpm --breakdowns age,gender --table

# Export insights to CSV/JSON
social marketing insights --preset last_7d --level campaign --fields spend,impressions,clicks --export ./report.csv
social marketing insights --preset last_7d --level campaign --fields spend,impressions,clicks --export ./report.json
social marketing insights --preset last_7d --level campaign --fields spend,impressions,clicks --export ./report.csv --append

# Quick status (spend today + active campaigns + rate-limit header snapshot)
social marketing status

# List ads + audiences
social marketing ads --table
social marketing audiences --table

# Create ad set + creative + ad (high risk; defaults to PAUSED unless you set ACTIVE)
social marketing create-adset <CAMPAIGN_ID> --name "Test Adset" --targeting "{\"geo_locations\":{\"countries\":[\"US\"]}}"
social marketing create-creative --name "Test Creative" --page-id <PAGE_ID> --link "https://example.com" --body-text "Hello" --image-url "https://example.com/creative.png" --call-to-action LEARN_MORE
social marketing create-ad <ADSET_ID> --name "Test Ad" --creative-id <CREATIVE_ID>

# Operate safely: pause/resume + budget updates (high risk)
social marketing pause campaign <CAMPAIGN_ID>
social marketing resume adset <ADSET_ID>
social marketing set-budget campaign <CAMPAIGN_ID> --daily-budget 15000
social marketing set-budget adset <ADSET_ID> --daily-budget 8000

# High risk: create a campaign (defaults to PAUSED)
social marketing create-campaign --name "Test Camp" --objective OUTCOME_SALES --daily-budget 10000
```

Safety note: Always test writes (`create-*`, `set-status`, `set-budget`) on a sandbox/test ad account first. These operations can affect real spend.

## Agent Mode (Meta DevOps Co-pilot)

`social agent` plans first, then executes only after you confirm.

### Safety Model

- No shell exec, no arbitrary code.
- Strict tool registry: agent steps must use registered tool names.
- High-risk tools (example: `whatsapp.send`) require an extra confirmation per step.
- Scoped memory (optional) stored at `~/.social-cli/context/<scope>/`:
  - `memory.json` (append-only entries: decision/status/config)
  - `summary.md` (human-readable)
- Secrets/tokens are redacted before writing memory.
- Memory staleness (> 7 days) is warned during planning.

### Usage

```bash
social agent "fix whatsapp webhook for clientA"
social agent --scope clientA "check auth + list pages"

# Plan only
social agent --plan-only "inspect app subscriptions"

# Disable memory
social agent --no-memory "check my rate limits"

# JSON output
social agent --json --plan-only "check my setup"
```

### Memory Commands

```bash
social agent memory list
social agent memory show clientA
social agent memory forget clientA
social agent memory clear
```

### LLM Key Setup

For LLM planning, set `SOCIAL_AGENT_API_KEY` (or `OPENAI_API_KEY`). If no key is set, the agent falls back to a conservative heuristic planner.

```powershell
setx SOCIAL_AGENT_API_KEY "YOUR_KEY"
social agent --provider openai --model gpt-4o-mini "list my pages"
```

### Local AI (Ollama, 16GB RAM friendly)

If you do not want cloud API keys, use local Ollama. This runs models locally and does not require a paid API subscription:

```bash
ollama pull llama3.1:8b
social agent setup --provider ollama --model llama3.1:8b
```

Other 16GB-friendly models:

- `qwen2.5:7b`
- `mistral:7b`

## Ops Knowledge Sources

Onyx-style connector visibility is available in both CLI and localhost Ops Center.

```bash
social ops sources list
social ops sources upsert --name "Campaign Source" --connector csv_upload --sync-mode manual
social ops integrations set --workspace clientA --slack-webhook https://hooks.slack.com/services/...
social ops sources upsert --workspace clientA --name "Slack Routing" --connector slack_channels --sync-mode scheduled
social ops sources sync
```

## AI Natural Language Interface (`social ai`)

`social ai` lets you describe an action in plain English and executes a safe mapped command flow:

- Parse intent (LLM first, heuristic fallback)
- Validate required fields and formats
- Show risk-aware confirmation UI
- Execute via internal API client functions (no shell/eval)

### Examples

```bash
social ai "show my pages"
social ai "what are my Facebook pages?"
social ai "who am I on Instagram"
social ai "check if I'm close to rate limit"
social ai "post 'New product launch!' to my Facebook page with link https://product.com"
social ai "schedule post 'Tomorrow launch reminder' to My Business Page tomorrow at 10am"
social ai "post sunset photo to Instagram with caption 'Beautiful evening' from https://cdn.example.com/sunset.jpg"
social ai "send WhatsApp message 'Order confirmed' to +919812345678"
social ai "list my active ad campaigns for account act_123456789"
social ai "get ad performance for last 30 days"
social ai "show campaign spend for account act_123456789"
social ai "create campaign 'Summer Sale' with objective OUTCOME_SALES and daily budget 10000"
```

### Flags

- `--yes`: skips confirmation for low/medium risk actions (high risk always confirms)
- `--debug`: prints parse/execution internals (sanitized)
- `--json`: prints raw result JSON
- `--ink`: use Ink prompt UI for confirmation when available

### Safety

- No `eval()` and no shell command execution in AI flow
- High-risk actions require user confirmation
- Tokens are redacted in debug logs
- Invalid/missing fields block execution until corrected

See `docs/AI_INTERFACE.md` for full architecture and troubleshooting.

## Conversational Chat Agent (`social chat`)

`social chat` is a persistent, multi-turn assistant built on top of the same safe execution layer as `social ai`.

### What it does

- Keeps context across messages in a session
- Routes work across specialist agents (`Router`, `Marketing`, `Developer`, `Ops`, `Connector`)
- Enforces specialist tool-scope boundaries before execution
- Executes concrete `Ops` and `Connector` specialist actions (summary, morning-run, run-due, ack token alerts, approve low-risk, source list/sync)
- Proposes actions and waits for explicit confirmation
- Optional terminal autonomy with `--agentic` (auto-executes non-high-risk actions)
- Executes through internal API clients (no shell/eval)
- Saves and resumes sessions across CLI runs

### Quick usage

```bash
# start a new conversation
social chat

# start in terminal autonomous mode (still asks for high-risk actions)
social chat --agentic

# resume a specific session
social chat --session chat_20260215150000_ab12cd

# list recent sessions
social chat sessions
```

### In-session commands

- `help`: examples and usage tips
- `summary`: show known facts and pending actions
- `exit`: save and quit

See `docs/CHAT_AGENT.md` for architecture, flow, and safety details.

## Social API Gateway UI (`social gateway`)

Run a local web app with a polished chat interface and backing API gateway:

```bash
social gateway --open
# or
social studio
```

Options:

- `--host <host>` (default `127.0.0.1`)
- `--port <port>` (default `1310`)
- `--api-key <key>` (expect `x-gateway-key` on protected API routes)
- `--require-api-key` (enforce key even for localhost requests)
- `--cors-origins <csv>` (strict CORS allowlist)
- `--rate-limit-max <n>` (default `180`)
- `--rate-limit-window-ms <ms>` (default `60000`)
- `--open` (launch browser)
- `--debug` (chat/parser debug logs)

Security defaults:

- `GET /api/health` is public for liveness checks.
- Other `/api/*` routes are protected by auth/rate-limit middleware.
- Non-local requests are denied unless a gateway API key is configured.
- CORS is strict: by default only localhost origins are allowed when bound to localhost.

Gateway endpoints:

- `GET /api/health`
- `GET /api/status`
- `GET /api/sessions`
- `GET /api/config`
- `POST /api/chat/start`
- `POST /api/chat/message`
- `POST /api/ai` (alias of chat message route for Studio UI)
- `POST /api/execute` (execute a provided plan)
- `POST /api/cancel` (cancel stub response for compatibility)
- `GET /api/team/activity/export?format=json|csv&workspace=<ws>&actor=<id>&from=<ISO>&to=<ISO>&limit=<n>`
- `WS /ws` (live output/plan/step events)

UI assets are served from `web/studio/`.

The gateway covers both marketing flows and developer diagnostics (auth status, token debug, webhook subscriptions).
It includes dedicated tabs for `Chat`, `Posts`, `Analytics`, `Data Console`, `Config`, `Help`, and `Settings`.
In `Settings`, Social Studio now includes:

- guided `WhatsApp Integration` card with doctor checks and connect/disconnect actions
- `Region Policy` card for country/timezone/mode + preflight
- `Team Management` card for active operator + role assignment

In `Ops`, Social Studio includes `Team Activity` (who did what, when, status).
Approval actions in Studio are role-gated (`operator`/`owner` only). `viewer`/`analyst` can inspect but cannot approve/reject.
Team Activity can be exported from Studio as `JSON` or `CSV`.

Studio shortcuts:

- `Ctrl/Cmd + Enter`: send message
- `Ctrl/Cmd + K`: command palette
- `Ctrl/Cmd + N`: new session
- `Ctrl/Cmd + 1/2/3/4`: switch top views (`Chat/Posts/Analytics/Settings`)

## Ops Control Plane (`social ops`)

`social ops` is an agency-oriented operations surface that adds high-value workflow automation:

- Morning Ops workflow (`token health + spend guardrails + follow-up queue`)
- Persistent lead state machine (`new -> contacted -> no_reply_3d -> followup_due`)
- Alerts inbox and approval queue for high-risk actions
- Scheduler for recurring workflow runs
- Integration settings for Slack/generic webhook handoff
- Policy controls (thresholds and approval requirements)
- Role-based controls per workspace
- Outcome tracking for operational impact

Quick examples:

```bash
# bootstrap a workspace with daily morning checks
social ops onboard --workspace clientA

# run checks now for all profiles
social ops morning-run --all-workspaces --spend 320

# inspect and resolve risk gates
social ops alerts list --workspace clientA --open
social ops approvals list --workspace clientA --open
social ops approvals approve <APPROVAL_ID> --workspace clientA

# manage lead follow-up state
social ops leads add --workspace clientA --name "Alice" --phone +15551234567
social ops leads update <LEAD_ID> --workspace clientA --status no_reply_3d

# schedule automation
social ops schedule add --workspace clientA --name "Daily Ops" --run-at 2026-02-17T09:00:00Z --repeat daily
social ops schedule run-due --workspace clientA

# integrations
social ops integrations set --workspace clientA --slack-webhook https://hooks.slack.com/services/...
social ops integrations show --workspace clientA
```

## Hub Registry (`social hub`)

`social hub` provides a versioned package surface for reusable connectors, playbooks, and skills.

Quick examples:

```bash
# discover packages
social hub search ops
social hub search --type connector --tag slack

# inspect package metadata + versions
social hub inspect connector.slack.alerts
social hub inspect connector.slack.alerts@1.0.0

# install/update and list installed packages
social hub install connector.slack.alerts
social hub update
social hub list

# sync catalog from file/URL and publish signed packages
social hub sync --source ./hub-catalog.json
social hub publish ./package-manifest.json --private-key ./publisher-private.pem

# enforce trust policy + publisher keys
social hub trust set --mode enforce --require-signed true
social hub trust allow acme-labs
social hub trust import-key acme-labs --file ./acme-public.pem
```

## Disclaimer

Unofficial tool. Not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc.

## License

MIT
