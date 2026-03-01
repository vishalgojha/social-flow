# Social Flow SDK (TypeScript)

Typed client for the Social Flow Gateway SDK routes (`/api/sdk/*`).

## Install (local workspace)

```bash
npm --prefix sdk install
npm --prefix sdk run build
```

## Example

```ts
import { createSocialFlowClient } from "@vishalgojha/social-flow-sdk";

const client = createSocialFlowClient({
  baseUrl: "http://127.0.0.1:1310",
  gatewayKey: process.env.SOCIAL_GATEWAY_API_KEY || ""
});

const plan = await client.actions.plan("create_post", {
  message: "Launch update",
  pageId: "123456789"
});

if (plan.ok && plan.meta.requiresApproval && plan.meta.approvalToken) {
  const executed = await client.actions.execute(
    "create_post",
    { message: "Launch update", pageId: "123456789" },
    {
      approvalToken: plan.meta.approvalToken,
      approvalReason: "approved by operator"
    }
  );
  console.log(executed);
}
```

## Core Methods

- `client.health.status()`
- `client.health.doctor()`
- `client.profile.get(fields?)`
- `client.posts.create(input, approval?)`
- `client.ads.list(input?)`
- `client.whatsapp.send(input, approval?)`
- `client.logs.list(limit?)`
- `client.replay.run(input, approval?)`
- `client.actions.plan(action, params?)`
- `client.actions.execute(action, params?, approval?)`

## Guardrails

- Each response includes `meta.risk` and `meta.requiresApproval`.
- Medium/high-risk actions require approval token flow:
  1. `plan`
  2. `execute` with `approvalToken` (+ `approvalReason` for high-risk)
