# Bullhorse Architecture Summary

Bullhorse is a Telegram-first coding agent runtime built as a layered system:

1. Transport layer receives requests (HTTP + Telegram).
2. Graph layer orchestrates agentic and deterministic nodes.
3. Harness layer adapts graph nodes to DeepAgents.
4. Tool layer exposes capabilities to the model.
5. Sandbox layer provides isolated execution backends.
6. Config layer wires providers, runtime mode, and safety settings.

## Layered Architecture

### 1) Transport Layer

- `src/index.ts` starts Bun HTTP server and Telegram long polling.
- `src/webapp.ts` exposes:
  - `POST /run`
  - `POST /v1/chat/completions`
  - `POST /webhook/telegram`
  - `POST /webhook/github`
  - `GET /health`, `GET /info`

### 2) Graph Orchestration Layer

- `src/server.ts` builds and runs the `StateGraph` over `CodeagentState`.
- `src/utils/state.ts` defines shared state used across all nodes.
- Pipeline modes:
  - Standard: `coder -> format -> linter -> validate -> tests`
  - Extended (`EXTENDED_MODE=true`): `planner -> coder -> format -> linter -> validate -> tests -> fixer`

### 3) Harness Layer

- `src/harness/agentHarness.ts` defines the backend contract.
- `src/harness/deepagents.ts` implements the contract using `createDeepAgent(...)`.
- Harness responsibilities:
  - Per-thread agent lifecycle.
  - `--repo` parsing and thread repo binding.
  - Sandbox acquisition/cleanup when enabled.
  - Model/provider wiring and retries.

### 4) Tool Layer

- `src/tools/index.ts` assembles model-facing tools.
- `allTools`: generic tools (`commit_and_open_pr`, `fetch_url`, `search`).
- `sandboxAllTools`: generic tools plus sandbox shell/file tools.

### 5) Sandbox Layer

- `src/integrations/sandbox-service.ts` provides provider-agnostic interface.
- Providers:
  - `src/integrations/opensandbox.ts`
  - `src/integrations/daytona.ts`
- `src/integrations/daytona-pool.ts` manages pooled sandbox reuse by repo/profile.

### 6) Config Layer

- `src/utils/config.ts` loads and validates runtime config:
  - LLM: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `MODEL`
  - Optional LLM fallback: `OPENAI_BASE_URL_FALLBACK`, `OPENAI_API_KEY_FALLBACK`, `MODEL_FALLBACK`
  - Pipeline: `WORKSPACE_ROOT`, `LINTER_COMMAND`
  - Transport: `TELEGRAM_BOT_TOKEN`, `PORT`
  - Security: `GITHUB_WEBHOOK_SECRET`, token encryption key settings

## Request Lifecycle

1. Request arrives from HTTP (`/run` or chat endpoint) or Telegram.
2. `runCodeagentTurn()` invokes the compiled LangGraph.
3. Agentic node (`coder` / `planner` / `fixer`) calls Harness.
4. Harness invokes DeepAgents with configured tools and runtime context.
5. Deterministic nodes run format/lint/validate/tests.
6. Graph routes to loop-back on failure (bounded by max iterations) or terminates.
7. Final response aggregates node outputs into user-facing text.

## Runtime Modes

### Standard Mode

- Entry: `coder`
- Best for quick coding flows and lower runtime overhead.

### Extended Mode

- Entry: `planner`
- Exit through `fixer` after deterministic checks pass/fail routing.
- Best for complex tasks with explicit plan-first behavior.

## Reliability and Security Controls

- Retry + exponential backoff for transient LLM provider failures.
- Optional fallback model/provider when primary config is rate limited.
- Deterministic routing fields for post-node decisions.
- GitHub webhook signature verification with constant-time comparison.
- Persisted thread metadata for repo/sandbox continuity across restarts.
- Startup config self-checks to fail fast on invalid deployment wiring.

## Known Operational Risks

- External provider quota/rate limits can still reduce throughput.
- Sandbox provider outages can degrade agentic capability.
- Long-lived thread metadata requires TTL cleanup and periodic maintenance.

## Mitigation Roadmap

1. Reliability first: retries, fallback model/provider, degraded-mode replies.
2. Routing correctness: structured node statuses instead of error-string parsing.
3. Security baseline: strict webhook verification and token-at-rest encryption.
4. Durability: restart-safe thread metadata persistence and rehydration.
5. Observability: startup checks and per-node timing/iteration metrics.
