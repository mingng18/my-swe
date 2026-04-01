import { createLogger } from "../utils/logger";
import { loadPipelineConfig } from "../utils/config";
import { getAgentHarness } from "../harness";
import type { CodeagentStateType } from "../utils/state";
import { withMessageQueueCheck } from "../middleware/check-message-queue";
import { withEnsureNoEmptyMsg } from "../middleware/ensure-no-empty-msg";

const logger = createLogger("planner");

/**
 * Agentic node: Plan the approach before coding.
 *
 * This node analyzes the task and creates a plan before the coder executes.
 * It helps break down complex tasks into manageable steps.
 *
 * @param state - The current agent state
 * @returns Updated state with plan
 */
async function plannerCore(state: CodeagentStateType) {
  logger.info(
    { inputLength: state.input.length },
    "[codeagent][agentic][planner] in",
  );

  try {
    const { workspaceRoot } = loadPipelineConfig();
    logger.info({ workspaceRoot }, "[codeagent][agentic][planner] workspace");

    const harness = await getAgentHarness(workspaceRoot);

    // Get threadId from state
    const threadId =
      state.threadId ||
      (state.configurable?.thread_id as string | undefined) ||
      "default-session";

    // Create a planning prompt
    const planningPrompt = `You are a planning agent. Analyze the following task and create a detailed plan.

Task: ${state.input}

Please provide:
1. A brief summary of what needs to be done
2. The files that likely need to be modified
3. The order of operations
4. Potential edge cases to consider

Keep your plan concise and actionable. Do NOT execute any code - just plan.`;

    const { reply, error } = await harness.run(planningPrompt, { threadId });

    logger.info(
      { replyLength: reply.length, hadError: Boolean(error) },
      "[codeagent][agentic][planner] out",
    );

    return {
      plan: reply || "",
      error: error || "",
      messages: state.messages || [],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ error: e }, "[codeagent][agentic][planner] error");
    return {
      plan: "",
      error: msg,
      messages: state.messages || [],
    };
  }
}

/**
 * Apply middleware wrappers to the planner node.
 */
export const plannerNode = withEnsureNoEmptyMsg(
  withMessageQueueCheck(plannerCore),
);
