import { createLogger } from "./utils/logger";
import { getAgentHarness } from "./harness";

const logger = createLogger("server");

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
 */
export async function runCodeagentTurn(
  userText: string,
  threadId?: string,
): Promise<string> {
  const startedAt = Date.now();

  try {
    const harness = await getAgentHarness();
    const result = await harness.run(userText, {
      threadId: threadId ?? "default-session",
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
