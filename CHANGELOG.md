# Changelog

## 0.3.0-alpha-launcher

- Added OpenClaw-style interactive launcher when running `social` with no command.
- Added `social onboard` guided wizard with doctor checks and auto-launch to Hatch UI.
- Added `social hatch` alias for terminal agent chat (`social tui`).
- Upgraded agentic TUI to chat-first layout with PLAN/ACTIONS_QUEUE/LIVE_LOGS/APPROVALS/RESULTS/ROLLBACK.
- Added replay improvements: suggestions, `replay latest`, and dry-run preview before high-risk approval.
- Improved WhatsApp auth login UX to avoid opening docs by default; now shows direct token-generation hint.
- Updated CLI help examples to remove `$` prompt prefix and improve copy/paste usability.
- Changed `social chat` to onboarding-first behavior and route it to Hatch UI (legacy alias).

## 0.2.8

- Release: fix tag-based release notes generation by adding changelog entries for recent versions.
- Docs: added maintainer release instructions (GitHub Actions + `NPM_TOKEN` secret).

## 0.2.9

- Release: remove OTP requirement from GitHub Actions publish step (CI should use `NPM_TOKEN` only).

## 0.2.10

- Release: make release notes extraction resilient (`--allow-missing`) so publishing isn't blocked.

## 0.2.7

- CI: keep `package-lock.json` in sync so `npm ci` works in GitHub Actions.
- Release: added tag-based GitHub Actions workflow to publish to npm + create GitHub Releases.

## 0.2.6

- UX: improved banner readability and added `--banner-style`, `--color/--no-color`, `--no-banner` flags.

## 0.2.0

- Added Marketing API support: `meta marketing` (ad accounts, campaigns, ad sets, creatives, async insights, status, create-campaign).
- Added Ads throttling retry/backoff in shared API client (handles error codes 17/32).
- Config: added default Marketing ad account id (`defaults.marketingAdAccountId`).

## 0.2.1

- Marketing: `create-adset`, `create-creative`, `create-ad`, `upload-image`.
- Marketing: `insights --export` to CSV/JSON.

## 0.2.2

- Marketing: `set-status`, `pause`, `resume` for campaigns/ad sets/ads.
- Marketing: `set-budget` for campaigns/ad sets.

## 0.2.3

- Marketing: updated create flows to support object-id-based ops:
  - `create-adset <campaignId>` (auto-resolves ad account)
  - `create-ad <adsetId>` (auto-resolves ad account)
- Marketing: `create-creative` supports `--image-url` and `--video-url` (auto-upload) plus `--body-text/--headline`.
- Marketing: `insights --export ... --append` for CSV/JSON.

## 0.2.4

- Multi-account profiles: `meta accounts ...` and global `--profile <name>`.
- Batch runner: `meta batch run jobs.(json|csv)` using registered tools.

## 0.2.5

- Added test harness (`node test/run.js`) with coverage of config profiles, API redaction/retry, insights export append, and batch BOM handling.
- Added GitHub Actions CI workflow to run tests on Node 18/20/22.
- Packaging: `files` whitelist for safer npm publishes.
