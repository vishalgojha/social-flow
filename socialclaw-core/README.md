# SocialClaw Core

```text
                     +------------------------+
                     |   API Gateway (Fastify)|
                     +-----------+------------+
                                 |
       +-------------------------+--------------------------+
       |                         |                          |
 +-----v------+          +-------v-------+          +------v------+
 | RBAC/Auth  |          | AI Draft Gen  |          | Workflow API |
 +-----+------+          +-------+-------+          +------+-------+
       |                         |                         |
       +-------------------------+-------------------------+
                                 |
                          +------v------+
                          | PostgreSQL  |
                          | Multi-tenant|
                          +------+------+
                                 |
                    +------------v-------------+
                    | BullMQ Queue + Workers   |
                    | retries/backoff/safety   |
                    +------------+-------------+
                                 |
                        +--------v---------+
                        | Audit + Metrics  |
                        | Prometheus/Sentry|
                        +------------------+
```

## Modules
- `src/api`: Fastify routes and request validation.
- `src/security`: JWT auth, RBAC guard middleware, rate-limit and safety controls.
- `src/ai`: Intent-to-structured-workflow generation and validation.
- `src/workflows`: JSON Schema + AJV validation logic.
- `src/engine`: Queue, worker, retry/backoff, safety gates.
  - deterministic runtime in `src/engine/runtime.ts` (node-by-node execution, graph edges via `next`/`onTrue`/`onFalse`, no free-form planning at run-time)
- `src/db`: PostgreSQL client and SQL schema.
- `src/observability`: structured logs and Prometheus metrics.
- `tests`: Jest unit + integration tests.
- `deploy`: Docker, Kubernetes, Nginx TLS reverse proxy.

## Quick Start
1. Copy `.env.example` to `.env`.
2. Provision PostgreSQL and Redis.
3. Run `npm install`.
4. Apply SQL from `src/db/schema.sql`.
5. Run API: `npm run dev`
6. Run worker: `npm run worker:dev`

## Release Readiness
- Track go-live requirements in `RC_CHECKLIST.md`.
- Keep `EXECUTION_DRY_RUN=true` until staging validation is complete.
