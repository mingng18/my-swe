# Cloudflare Containers Deployment — Design Spec

- **Date:** 2026-06-21
- **Status:** Approved (model = Cloudflare Containers; v1 = minimal/ephemeral)
- **Owner:** my-swe (Bullhorse)

## 1. Goal

Deploy my-swe to Cloudflare using **Cloudflare Containers** — run the existing Bun Docker image on Cloudflare's network via `wrangler deploy`. v1 is the minimal path to "live on Cloudflare"; durability hardening (R2/D1) is a documented follow-up.

## 2. Why Containers (not Workers)

my-swe is a Bun server that executes code: it shells out via `child_process` (linter/tests/git), uses the filesystem + `bun:sqlite`, runs `Bun.serve`, long-polls Telegram, and runs the LangGraph + DeepAgents runtime. None of that runs on Cloudflare Workers (V8 isolates). The app already containerizes (`Dockerfile` + `langgraph.json`) and delegates heavy code execution to external sandboxes (Daytona/OpenSandbox), so Containers is the faithful, low-risk fit.

## 3. Architecture

- A single Cloudflare Container instance runs the existing `oven/bun:1` image, built and pushed by `wrangler deploy`.
- Cloudflare terminates TLS and routes HTTPS to the container on its port (`7860`); scale-to-zero is available.
- External dependencies are reached over the network as today: LLM API (`OPENAI_*`/`MODEL`), Supabase (memory), Daytona/OpenSandbox (sandbox), GitHub, Telegram, Langfuse.

## 4. Changes (v1)

- **`wrangler.jsonc`** — containers config: `name`, build = the `Dockerfile`, `port: 7860`, non-secret env vars. (Exact schema sourced from the `wrangler` skill / CF Containers docs at implementation time.)
- **Port** — app already binds `process.env.PORT` (`src/index.ts:29`, default 7860); confirm `Bun.serve` listens on `0.0.0.0` (Bun default). No code change expected.
- **Secrets** — move from `.env` to `wrangler secret put` / CF dashboard: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `MODEL`, `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `GITHUB_DEFAULT_OWNER`, Supabase creds, `LANGFUSE_*`, and any sandbox creds. Loop flags (`LOOP_ENABLED`, `LOOP_SCHEDULING_ENABLED`, `LOOP_SELF_IMPROVE_ENABLED`) default **off** → zero behavior change.
- **Dockerfile** — keep as-is; optionally drop `ENV PORT=7860` so CF's port wins. No structural change.
- **Makefile** — add a `deploy` target (`wrangler deploy`) and a `cf-secrets` helper note.

## 5. Persistence (v1 decision: minimal/ephemeral)

- The loop `state-store` (fs JSON) and `trace-store` (`bun:sqlite`+JSONL) are instance-local → **ephemeral**: lost on redeploy/restart.
- This is acceptable for v1 because the app's durable data already lives externally (Supabase memory, GitHub). Consequence: loops do not resume across a restart, and L4 self-improvement traces reset on redeploy.
- **Follow-up (v1.1):** add durable backends behind the existing `StateStore`/`TraceStore` interfaces — loop state → **CF R2**, traces → **CF D1**. Additive; no surface change.

## 6. Scheduler

Single instance → the in-process `LoopScheduler` (L3) runs once; no duplicate scheduled loops. Multi-instance would need external cron / leader election — out of scope for v1.

## 7. Transport + health

- Telegram long-polling works as-is inside the container (outbound). Webhook mode (CF-routed) is optional.
- `/health` already exists for Cloudflare's health probe.

## 8. Verify

Deploy to CF Containers, then smoke-test:
1. `GET /health` → 200.
2. `POST /run` with `LOOP_ENABLED` unset → legacy one-shot reply.
3. `POST /loop/:threadId/status` (loop wired) and (optionally) a `LOOP_ENABLED=true` run.

## 9. Deploy / auth

`wrangler deploy` requires Cloudflare auth — either interactive `wrangler login` (user runs it) or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env vars for non-interactive CI. The implementation prepares all artifacts; the final auth + deploy step is user-driven.

## 10. Out of scope (v1)

- Durable R2/D1 persistence (v1.1).
- Multi-instance scheduling / leader election.
- Edge hybrid (Workers front-end).
- Migrating Telegram from long-polling to webhook (optional later).
