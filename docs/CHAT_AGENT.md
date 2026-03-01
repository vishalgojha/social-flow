# Conversational Chat Agent (`social chat`)

## Status (March 1, 2026)

`social chat` is now a legacy alias that routes to Hatch UI (`social hatch`) for main interactive use.

Use `docs/HATCH_UI.md` as the primary conversational runtime guide.

## Overview

`social chat` adds a persistent multi-turn conversation loop to `social-cli`.

Core flow:

1. User sends free-form message
2. Agent updates context (messages + extracted facts)
3. Agent proposes tool actions (LLM-driven, API-key required)
4. User confirms (`yes`) or rejects (`no`)
5. Agent executes approved actions safely
6. Session is persisted and resumable

## New Components

- `commands/chat.js`
- `lib/chat/session.js`
- `lib/chat/context.js`
- `lib/chat/agent.js`
- `lib/chat/prompt.js`
- `lib/chat/memory.js`

## Session Persistence

Session files are stored at:

- `~/.social-cli/chat/sessions/<session-id>.json`

Features:

- Resume with `social chat --session <id>`
- List sessions with `social chat sessions`
- Auto-save after each turn

## Conversation Behavior

The agent supports:

- Clarifying questions when fields are missing
- Pending action confirmation across turns
- Follow-up suggestions after successful tasks
- Conversational responses (not raw intent diagnostics)

Example:

```text
You: check my rate limits
Agent: I can check your current rate limit status now.
       Reply "yes" to execute now, or tell me what to change.

You: yes
Agent: Perfect. I will execute that now.
       ✓ Fetched current rate-limit headers.
```

## Safety Model

- No shell execution, no `eval()`
- Uses `lib/ai/executor.js` for direct API-client mapping
- High-risk actions are confirmation-gated
- Session data stores context only (no access tokens)

## LLM Requirements

Decision strategy:

- Chat planning requires a valid cloud API key.
- If key/config is missing, agent returns setup guidance and does not execute actions.

LLM endpoint config:

- `OPENAI_BASE_URL` (default: `https://api.openai.com/v1`)
- `SOCIAL_CHAT_MODEL` (resolution order: `SOCIAL_CHAT_MODEL`, then `SOCIAL_AI_MODEL`, then `gpt-4o-mini`)

## CLI Options

- `social chat --session <id>`
- `social chat --yes`
  - auto-approve low-risk execution branches
- `social chat --debug`
  - parser/decision debug traces

## Testing

Chat coverage is in:

- `test/chat.test.js`

Includes:

- fact extraction and pending actions
- session persistence save/load
- multi-turn pending-action confirmation
- small-talk handling
