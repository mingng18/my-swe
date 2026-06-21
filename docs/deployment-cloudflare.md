# Deploying my-swe to Cloudflare (Containers)

my-swe runs on **Cloudflare Containers** — a thin Worker (entry) + a `Container`
Durable-Object class that runs the existing Bun Docker image unchanged in a
Linux VM. This keeps the app's shell/`child_process`, filesystem, `bun:sqlite`,
`Bun.serve`, and LangGraph runtime all working (none of which run on Workers).

## Architecture

```
HTTPS request
  │
  ▼
Cloudflare Worker (cf/worker.ts)  ──►  env.MY_SWE.getByName("default").fetch(req)
  │
  ▼
MySweContainer (cf/container.ts, Durable Object)  ──envVars──►  Linux VM
  │                                                                  │
  ▼                                                                  ▼
Docker image (./Dockerfile, oven/bun:1)  ──────────────────  bun run src/index.ts
  • Bun.serve on $PORT (7860)  • long-polls Telegram  • calls external LLM/Supabase/sandbox
```

Secrets/config flow: `wrangler secret put <NAME>` (or `vars` in `wrangler.jsonc`)
→ Worker `env` → the container's `envVars` (cf/container.ts) → container
`process.env` → my-swe reads them as usual.

## Prerequisites

1. **Cloudflare account** + `wrangler` authenticated:
   ```bash
   bunx wrangler login          # interactive OAuth (opens a browser)
   # — or, for CI / non-interactive —
   export CLOUDFLARE_API_TOKEN=...   # token with Workers/Containers edit perms
   export CLOUDFLARE_ACCOUNT_ID=...
   ```
2. **Docker running locally** (`docker info` must succeed) — `wrangler deploy`
   builds the image with Docker and pushes it to Cloudflare's registry.

## Configure secrets

Set each secret the app needs (it will be injected into the container env).
Required for a working deployment:

```bash
bunx wrangler secret put OPENAI_BASE_URL
bunx wrangler secret put OPENAI_API_KEY
bunx wrangler secret put MODEL
bunx wrangler secret put TELEGRAM_BOT_TOKEN
bunx wrangler secret put GITHUB_TOKEN
# optional:
bunx wrangler secret put GITHUB_DEFAULT_OWNER
bunx wrangler secret put GITHUB_WEBHOOK_SECRET
bunx wrangler secret put SUPABASE_URL
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
bunx wrangler secret put LANGFUSE_PUBLIC_KEY
bunx wrangler secret put LANGFUSE_SECRET_KEY
bunx wrangler secret put LANGFUSE_HOST
bunx wrangler secret put DAYTONA_API_KEY        # or OPENSANDBOX_API_KEY
```

Non-secret config defaults live in `wrangler.jsonc` `vars` (PORT, AGENT_PROVIDER,
loop flags off, etc.). Loop engineering flags are **off by default**; to turn on
a rung, set it as a secret or in `vars` (e.g. `bunx wrangler secret put LOOP_ENABLED`
→ `true`) and redeploy.

## Deploy

```bash
make cf-deploy        # = bunx wrangler deploy
# or: bunx wrangler deploy
```

What happens: wrangler builds the Docker image (linux/amd64), pushes it to the
Cloudflare registry, deploys the Worker, and provisions the container. The first
deploy is slowest (image build + push); later deploys reuse cached layers.

The Worker URL looks like `https://my-swe.<your-subdomain>.workers.dev`. Point a
custom domain at it in the Cloudflare dashboard if desired.

## Verify

```bash
URL=https://my-swe.<your-subdomain>.workers.dev
curl -fsS "$URL/health"                                  # -> {"status":"healthy",...}
curl -fsS -X POST "$URL/run" -H 'Content-Type: application/json' \
  -d '{"input":"ping"}'                                  # legacy one-shot (LOOP_ENABLED off)
curl -fsS "$URL/loop/default/status"                     # loop wiring (HITL status)
```

To exercise the loop, set `LOOP_ENABLED=true` (secret) and redeploy, then POST `/run`.

## Operational notes & follow-ups

- **Telegram transport:** the app **long-polls** Telegram (keeps the container
  warm). For scale-to-zero / lower cost, switch to **webhook mode**: set
  `WEBHOOK_URL` to the Worker URL + run the webapp entry instead of long-polling,
  then lower `sleepAfter` in `cf/container.ts`.
- **Persistence (v1 = ephemeral):** loop `state-store` (fs JSON) and `trace-store`
  (`bun:sqlite`+JSONL) are instance-local — lost on redeploy/restart. Core data
  stays durable on external Supabase/GitHub. **v1.1:** add `StateStore`/`TraceStore`
  backends over **R2** (state) and **D1** (traces) — the interfaces are already
  abstract, so this is additive.
- **Single instance:** `max_instances: 1` (avoids duplicate scheduled loops). To
  scale, add path-based routing in `cf/worker.ts` and external cron/leader
  election for `LoopScheduler`.
- **Image arch:** must be `linux/amd64`. `wrangler` builds with Docker; on
  Apple Silicon if the build errors on arch, build explicitly:
  `docker buildx build --platform linux/amd64 ...`.
- **Logs/metrics:** Workers & Pages → Containers in the Cloudflare dashboard;
  live logs via `bunx wrangler tail`.

## Files added for Cloudflare

- `wrangler.jsonc` — Worker + container + Durable Object config.
- `cf/worker.ts` — Worker entry (routes all HTTP to the singleton container).
- `cf/container.ts` — `Container` DO subclass (port 7860, env-var passthrough).
- `cf/tsconfig.json` — Workers-types tsconfig for the shim (the main Bun
  `tsconfig.json` excludes `cf/`).
- `Makefile` `cf-deploy` target.
