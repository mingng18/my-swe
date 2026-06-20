import { createLogger } from "./utils/logger";
import { getAgentHarness } from "./harness";
import { createLoopRunner } from "./loop/runner";
import { registerScheduledPatterns } from "./loop/scheduling";
import type { LoopScheduler } from "./loop/scheduler";

const logger = createLogger("server");

let loopRunnerSingleton: ReturnType<typeof createLoopRunner> | undefined;

/** Lazily create (or return) the shared loop runner used by transports. */
export function getLoopRunner() {
  if (!loopRunnerSingleton) loopRunnerSingleton = createLoopRunner();
  return loopRunnerSingleton;
}

let schedulerSingleton: ReturnType<typeof registerScheduledPatterns> | undefined;
let schedulerStarted = false;

/** Lazy scheduler singleton. Started once at startup when LOOP_SCHEDULING_ENABLED. */
export function getLoopScheduler() {
  if (!schedulerSingleton) schedulerSingleton = registerScheduledPatterns();
  return schedulerSingleton;
}

/** Call once at process startup to (optionally) start scheduled loops. */
export function startScheduledLoops() {
  const s = getLoopScheduler();
  if (schedulerStarted || s.list().length === 0) return s;
  s.start();
  schedulerStarted = true;
  return s;
}

/**
 * Run a single agent turn.
 *
 * This is the sole entry point for all transports (HTTP, Telegram, GitHub webhook).
 * The outer StateGraph pipeline has been eliminated — all orchestration
 * (planning, retry, fallback, context management) is now handled by
 * prebuilt middleware inside the Deep Agent harness.
 *
 * @param userText - The user's input message
 * @param threadId - Optional thread ID for conversation persistence. Defaults to "default-session"
 * @param userId - Optional user ID for observability and attribution
 */
export async function runCodeagentTurn(
  userText: string,
  threadId?: string,
  userId?: string,
  transport?: "telegram" | "http" | "github",
): Promise<string> {
  const startedAt = Date.now();

  try {
    if (process.env.LOOP_ENABLED === "true") {
      const runner = getLoopRunner();
      const res = await runner.run({
        input: userText,
        threadId: threadId ?? "default-session",
        userId,
        transport,
      });
      const max = 8190;
      const reply = res.reply;
      return reply.length > max ? `${reply.slice(0, max)}…` : reply;
    }

    const harness = await getAgentHarness();
    const result = await harness.run(userText, {
      threadId: threadId ?? "default-session",
      userId,
      transport,
    });

    logger.info(
      { elapsedMs: Date.now() - startedAt },
      "[codeagent] turn complete",
    );

    const reply = result.reply || result.error || "(empty reply)";

    // Truncate for transport layer limits (e.g. Telegram 4096 chars)
    const max = 8190;
    if (reply.length > max) {
      return `${reply.slice(0, max)}…`;
    }

    return reply;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(
      { elapsedMs: Date.now() - startedAt, error: errorMsg },
      "[codeagent] turn failed",
    );
    return `Error: ${errorMsg}`;
  }
}

// Optionally start scheduled loops at module load. Guarded by
// LOOP_SCHEDULING_ENABLED and only acts when patterns are registered, so this
// is a no-op in tests and when scheduling is disabled.
if (process.env.LOOP_SCHEDULING_ENABLED === "true") {
  startScheduledLoops();
}
