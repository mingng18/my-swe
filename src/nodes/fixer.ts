import { createLogger } from "../utils/logger";
import { loadPipelineConfig } from "../utils/config";
import { getAgentHarness } from "../harness";
import type { CodeagentStateType } from "../utils/state";
import { withMessageQueueCheck } from "../middleware/check-message-queue";
import { withEnsureNoEmptyMsg } from "../middleware/ensure-no-empty-msg";

const logger = createLogger("fixer");

/**
 * Agentic node: Fix test failures and validation errors.
 *
 * This node analyzes test failures and validation errors from previous
 * deterministic nodes and attempts to fix them.
 *
 * @param state - The current agent state (includes test/validation results)
 * @returns Updated state with fix attempt
 */
async function fixerCore(state: CodeagentStateType) {
  logger.info("[codeagent][agentic][fixer] in");

  try {
    const { workspaceRoot } = loadPipelineConfig();
    logger.info({ workspaceRoot }, "[codeagent][agentic][fixer] workspace");

    const harness = await getAgentHarness(workspaceRoot);

    // Get threadId from state
    const threadId =
      state.threadId ||
      (state.configurable?.thread_id as string | undefined) ||
      "default-session";

    // Check if there are any failures to fix
    const testFailed = state.testResults && !state.testResults.passed;
    const validationFailed =
      state.validationResults && !state.validationResults.passed;

    if (!testFailed && !validationFailed) {
      logger.info("[codeagent][agentic][fixer] No failures to fix");
      return {
        fixAttempt: "",
        messages: state.messages || [],
      };
    }

    // Build context about failures
    const failureContext: string[] = [];

    if (testFailed && state.testResults) {
      failureContext.push(`**Test Results:**\n${state.testResults.output}`);
    }

    if (validationFailed && state.validationResults) {
      failureContext.push(
        `**Validation Results:**\n${state.validationResults.output}`,
      );
    }

    const fixerPrompt = `You are a fixer agent. Analyze the following failures and fix them.

**Original Task:** ${state.input}

**Failures:**
${failureContext.join("\n\n")}

Please:
1. Analyze what went wrong
2. Make the necessary code changes to fix the issues
3. Use the appropriate tools to apply fixes

Focus on fixing the actual issues, not just suppressing errors.`;

    const { reply, error } = await harness.run(fixerPrompt, { threadId });

    logger.info(
      { replyLength: reply.length, hadError: Boolean(error) },
      "[codeagent][agentic][fixer] out",
    );

    return {
      fixAttempt: reply || "",
      error: error || "",
      messages: state.messages || [],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ error: e }, "[codeagent][agentic][fixer] error");
    return {
      fixAttempt: "",
      error: msg,
      messages: state.messages || [],
    };
  }
}

/**
 * Apply middleware wrappers to the fixer node.
 */
export const fixerNode = withEnsureNoEmptyMsg(withMessageQueueCheck(fixerCore));
