import { createLogger } from "../utils/logger";
import { loadPipelineConfig } from "../utils/config";

import { getAgentHarness } from "../harness";
import type { CodeagentStateType } from "../utils/state";
import { withMessageQueueCheck } from "../middleware/check-message-queue";
import { withEnsureNoEmptyMsg } from "../middleware/ensure-no-empty-msg";

const logger = createLogger("coder");

/**
 * Core coder logic that runs the agent.
 * Extracted as a separate function so middleware wrappers can be applied.
 */
async function coderCore(state: CodeagentStateType) {
  logger.info(
    { inputLength: state.input.length, hasMessages: Boolean(state.messages) },
    "[codeagent][agentic][coder] in",
  );
  try {
    const { workspaceRoot } = loadPipelineConfig();
    logger.info({ workspaceRoot }, "[codeagent][agentic][coder] workspace");

    const harness = await getAgentHarness(workspaceRoot);
    logger.info("[codeagent][agentic][coder] harness obtained");

    // Get threadId from state (set by middleware or configurable)
    const threadId =
      state.threadId ||
      (state.configurable?.thread_id as string | undefined) ||
      "default-session";

    const { reply, error, messages } = await harness.run(state.input, {
      threadId,
    });

    logger.info(
      {
        replyLength: reply.length,
        hadError: Boolean(error),
        messagesCount: messages?.length || 0,
      },
      "[codeagent][agentic][coder] out",
    );

    return {
      reply,
      error: error || "",
      messages: messages || state.messages || [],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Use pino's conventional `err` key so stack/message serialize.
    logger.error({ err: e }, "[codeagent][agentic][coder] error");
    return {
      reply: "",
      error: msg,
      messages: state.messages || [],
    };
  }
}

/**
 * Apply middleware wrappers to the coder node.
 * Wrappers are applied in order: message queue check → ensure no empty msg → core logic
 */
export const coderNode = withEnsureNoEmptyMsg(withMessageQueueCheck(coderCore));
