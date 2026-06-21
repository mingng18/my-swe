// Cloudflare Container Durable-Object class.
//
// This runs the my-swe Bun Docker image UNCHANGED inside a Linux VM. The Worker
// (cf/worker.ts) receives HTTP and forwards it to a singleton instance of this
// container; the container's Bun.serve (src/index.ts, port 7860) handles it.
//
// Secrets/config flow: `wrangler secret put <NAME>` (or wrangler.jsonc `vars`)
// -> Worker `env` -> this class's `envVars` -> container process env ->
// my-swe reads them via process.env.* as usual.

import { Container } from "cloudflare:containers";
import { env as _env } from "cloudflare:workers";

// `env` holds both wrangler.jsonc `vars` and Worker secrets. Cast to a record so
// we can pass any key through; the runtime env has exactly the vars + secrets
// that were configured.
const env = _env as unknown as Record<string, string | undefined>;

// Pass every environment variable my-swe might read through to the container.
// `env` holds both wrangler.jsonc `vars` (non-secret) and Worker secrets.
const passthrough = {
  // --- HTTP / runtime ---
  PORT: env.PORT,
  NODE_ENV: env.NODE_ENV,
  WEBHOOK_URL: env.WEBHOOK_URL,
  WORKSPACE_ROOT: env.WORKSPACE_ROOT,
  // --- LLM ---
  OPENAI_BASE_URL: env.OPENAI_BASE_URL,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  MODEL: env.MODEL,
  LLM_RETRY_ATTEMPTS: env.LLM_RETRY_ATTEMPTS,
  LLM_RETRY_BASE_MS: env.LLM_RETRY_BASE_MS,
  EXTENDED_MODE: env.EXTENDED_MODE,
  // --- Telegram ---
  TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
  // --- GitHub ---
  GITHUB_TOKEN: env.GITHUB_TOKEN,
  GITHUB_DEFAULT_OWNER: env.GITHUB_DEFAULT_OWNER,
  GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
  // --- Supabase (memory) ---
  SUPABASE_REPO_MEMORY_ENABLED: env.SUPABASE_REPO_MEMORY_ENABLED,
  SUPABASE_URL: env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_REPO_MEMORY_VECTOR_CHUNKS: env.SUPABASE_REPO_MEMORY_VECTOR_CHUNKS,
  // --- Langfuse (observability) ---
  LANGFUSE_PUBLIC_KEY: env.LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY: env.LANGFUSE_SECRET_KEY,
  LANGFUSE_HOST: env.LANGFUSE_HOST,
  // --- Harness / sandbox ---
  AGENT_PROVIDER: env.AGENT_PROVIDER,
  OPENCODE_HOSTNAME: env.OPENCODE_HOSTNAME,
  OPENCODE_PORT: env.OPENCODE_PORT,
  OPENCODE_START_TIMEOUT_MS: env.OPENCODE_START_TIMEOUT_MS,
  DEEPAGENTS_HOST: env.DEEPAGENTS_HOST,
  DEEPAGENTS_PORT: env.DEEPAGENTS_PORT,
  DEEPAGENTS_START_TIMEOUT_MS: env.DEEPAGENTS_START_TIMEOUT_MS,
  USE_SANDBOX: env.USE_SANDBOX,
  SANDBOX_PROVIDER: env.SANDBOX_PROVIDER,
  OPENSANDBOX_DOMAIN: env.OPENSANDBOX_DOMAIN,
  OPENSANDBOX_API_KEY: env.OPENSANDBOX_API_KEY,
  OPENSANDBOX_IMAGE: env.OPENSANDBOX_IMAGE,
  OPENSANDBOX_TIMEOUT: env.OPENSANDBOX_TIMEOUT,
  OPENSANDBOX_CPU: env.OPENSANDBOX_CPU,
  OPENSANDBOX_MEMORY: env.OPENSANDBOX_MEMORY,
  DAYTONA_API_KEY: env.DAYTONA_API_KEY,
  DAYTONA_IMAGE: env.DAYTONA_IMAGE,
  DAYTONA_CPU: env.DAYTONA_CPU,
  DAYTONA_MEMORY: env.DAYTONA_MEMORY,
  DAYTONA_DISK: env.DAYTONA_DISK,
  // --- Thread cleanup / compaction ---
  THREAD_CLEANUP_ENABLED: env.THREAD_CLEANUP_ENABLED,
  THREAD_CLEANUP_TTL_MS: env.THREAD_CLEANUP_TTL_MS,
  THREAD_CLEANUP_INTERVAL_MS: env.THREAD_CLEANUP_INTERVAL_MS,
  COMPACTION_CASCADE_TRIGGER_FRACTION: env.COMPACTION_CASCADE_TRIGGER_FRACTION,
  COMPACTION_TRIGGER_FRACTION: env.COMPACTION_TRIGGER_FRACTION,
  COMPACTION_KEEP_MESSAGES: env.COMPACTION_KEEP_MESSAGES,
  COMPACTION_MAX_FAILURES: env.COMPACTION_MAX_FAILURES,
  COMPACTION_MICROCOMPACT: env.COMPACTION_MICROCOMPACT,
  COMPACTION_MICROCOMPACT_GAP_MINUTES: env.COMPACTION_MICROCOMPACT_GAP_MINUTES,
  COMPACTION_RESTORATION: env.COMPACTION_RESTORATION,
  COMPACTION_RESTORATION_MAX_FILES: env.COMPACTION_RESTORATION_MAX_FILES,
  // --- Snapshots ---
  SNAPSHOT_ENABLED: env.SNAPSHOT_ENABLED,
  SNAPSHOT_INTERVAL_MINUTES: env.SNAPSHOT_INTERVAL_MINUTES,
  SNAPSHOT_MAX_AGE_HOURS: env.SNAPSHOT_MAX_AGE_HOURS,
  // --- Loop engineering (all off by default) ---
  LOOP_ENABLED: env.LOOP_ENABLED,
  LOOP_MAX_ITERATIONS: env.LOOP_MAX_ITERATIONS,
  LOOP_AUTONOMY_LEVEL: env.LOOP_AUTONOMY_LEVEL,
  LOOP_HITL_ENABLED: env.LOOP_HITL_ENABLED,
  LOOP_STATE_DIR: env.LOOP_STATE_DIR,
  LOOP_TRACE_DIR: env.LOOP_TRACE_DIR,
  LOOP_EVAL_GATE: env.LOOP_EVAL_GATE,
  LOOP_SCHEDULING_ENABLED: env.LOOP_SCHEDULING_ENABLED,
  LOOP_SCHEDULE_PR_BABYSITTER_MS: env.LOOP_SCHEDULE_PR_BABYSITTER_MS,
  LOOP_SCHEDULE_CI_SWEEPER_MS: env.LOOP_SCHEDULE_CI_SWEEPER_MS,
  LOOP_SCHEDULE_DAILY_TRIAGE_MS: env.LOOP_SCHEDULE_DAILY_TRIAGE_MS,
  LOOP_REPO: env.LOOP_REPO,
  LOOP_SELF_IMPROVE_ENABLED: env.LOOP_SELF_IMPROVE_ENABLED,
  LOOP_SELF_IMPROVE_EVAL_CASES: env.LOOP_SELF_IMPROVE_EVAL_CASES,
};

// Drop keys whose value is undefined so we don't inject literal "undefined".
const envVars: Record<string, string> = {};
for (const [k, v] of Object.entries(passthrough)) {
  if (v !== undefined && v !== null) envVars[k] = String(v);
}

export class MySweContainer extends Container {
  // my-swe listens on process.env.PORT (default 7860); keep these in sync.
  defaultPort = 7860;
  // Stay warm for a while after the last request. NOTE: my-swe long-polls
  // Telegram, which keeps the process busy and effectively prevents sleep.
  // For a cost-optimized, scale-to-zero setup, switch to Telegram webhook mode
  // (see docs/deployment-cloudflare.md) and lower this value.
  sleepAfter = "10m";

  envVars = envVars;

  override onStart() {
    console.log("[my-swe container] started");
  }
  override onStop() {
    console.log("[my-swe container] stopped");
  }
  override onError(error: unknown) {
    console.error("[my-swe container] error:", error);
  }
}
