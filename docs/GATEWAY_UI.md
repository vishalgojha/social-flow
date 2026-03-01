# Social API Gateway

## Command

```bash
social gateway
```

## Purpose

`social gateway` runs a local HTTP server that provides:

- a bundled Social Studio UI at `/`
- a safe API gateway for chat operations
- a WebSocket stream for live events

Supported workflow categories:

- Marketing/content operations (posts, campaigns, analytics)
- Developer operations (auth status, token debug, webhook subscription checks)

For remote hosting (Railway + external frontend), run gateway with a real API key and explicit CORS origins.

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
- `GET /api/sdk/status`
- `GET /api/sdk/doctor`
- `GET /api/sdk/actions`
- `POST /api/sdk/actions/plan`
- `POST /api/sdk/actions/execute`
- `WS /ws`

## SDK Contract

`/api/sdk/*` routes return a stable envelope:

```json
{
  "ok": true,
  "traceId": "sdk_xxx",
  "data": {},
  "error": null,
  "meta": {
    "action": "create_post",
    "risk": "MEDIUM",
    "requiresApproval": true,
    "approvalToken": "ap_xxx",
    "approvalTokenExpiresAt": "2026-01-01T00:00:00.000Z",
    "source": "gateway-sdk"
  }
}
```

For medium/high-risk actions:

1. Call `POST /api/sdk/actions/plan`
2. Use returned `approvalToken`
3. Call `POST /api/sdk/actions/execute` with `approvalToken` (and `approvalReason` for high-risk)

## Session Model

Sessions are persisted through the chat memory layer:

- storage path: `~/.social-cli/chat/sessions/*.json`
- resumed automatically when a known `sessionId` is provided

## Safety

- No shell execution in gateway action flow
- Uses `lib/chat/agent.js` + `lib/ai/executor.js`
- Pending actions require explicit conversational confirmation (`yes`/`no`)

## Railway + Frontend

Recommended env vars on Railway:

- `SOCIAL_GATEWAY_API_KEY=<long-random-secret>`
- `SOCIAL_GATEWAY_REQUIRE_API_KEY=true`
- `SOCIAL_GATEWAY_CORS_ORIGINS=https://<your-frontend-domain>`

Frontend requirements:

- Send `x-gateway-key` on REST requests.
- Use `wss://<gateway-domain>/ws?gatewayKey=<SOCIAL_GATEWAY_API_KEY>` for WebSocket auth.
- Health route (`/api/health`) remains public for platform probes.

## Files

- `commands/gateway.js`
- `lib/gateway/server.js`
