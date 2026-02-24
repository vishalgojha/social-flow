# Social API Gateway

## Command

```bash
social gateway
```

## Purpose

`social gateway` runs a local HTTP server that provides:

- a safe API gateway for chat operations
- a WebSocket stream for live events

Bundled `LOCALHOST GATEWAY` frontend UI has been removed from this repo.

Supported workflow categories:

- Marketing/content operations (posts, campaigns, analytics)
- Developer operations (auth status, token debug, webhook subscription checks)

## Endpoints

- `GET /api/health`
- `GET /api/status`
- `GET /api/sessions`
- `GET /api/config`
- `POST /api/config/update`
- `POST /api/chat/start`
- `POST /api/chat/message`
- `POST /api/ai`
- `POST /api/execute`
- `POST /api/cancel`
- `WS /ws`

## Session Model

Sessions are persisted through the chat memory layer:

- storage path: `~/.social-cli/chat/sessions/*.json`
- resumed automatically when a known `sessionId` is provided

## Safety

- No shell execution in gateway action flow
- Uses `lib/chat/agent.js` + `lib/ai/executor.js`
- Pending actions require explicit conversational confirmation (`yes`/`no`)

## Files

- `commands/gateway.js`
- `lib/gateway/server.js`
