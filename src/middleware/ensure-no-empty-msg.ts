/**
 * After-model middleware that ensures the model always produces meaningful output.
 *
 * If the model produces a message with no tool calls and no content, this middleware
 * injects a no_op tool call to prompt the model to continue. If the model produces
 * content but no tool calls (and hasn't completed the task), it injects a
 * confirming_completion tool call to prompt the model to verify completion.
 */

import { createLogger } from "../utils/logger";
import { createMiddleware } from "langchain";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("ensure-no-empty-msg");

/**
 * LangGraph message types
 */
export type MessageRole = "human" | "ai" | "system" | "tool";

/**
 * Base message interface
 */
export interface BaseMessage {
  type: MessageRole;
  content?: string;
  tool_calls?: ToolCall[];
  name?: string;
  text?(): string;
}

/**
 * Tool call interface
 */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
}

/**
 * Agent state interface
 */
export interface AgentState {
  messages: BaseMessage[];
}

/**
 * Get all messages since the last human message.
 */
export function getEveryMessageSinceLastHuman(
  state: AgentState,
): BaseMessage[] {
  const messages = state.messages;
  let lastHumanIdx = -1;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === "human") {
      lastHumanIdx = i;
      break;
    }
  }

  return messages.slice(lastHumanIdx + 1);
}

/**
 * Check if the model already called commit_and_open_pr.
 */
export function checkIfModelAlreadyCalledCommitAndOpenPr(
  messages: BaseMessage[],
): boolean {
  return messages.some(
    (msg) => msg.type === "tool" && msg.name === "commit_and_open_pr",
  );
}

/**
 * Check if the model messaged the user via Slack, Linear, or GitHub.
 */
export function checkIfModelMessagedUser(messages: BaseMessage[]): boolean {
  const communicationTools = [
    "slack_thread_reply",
    "linear_comment",
    "github_comment",
  ];
  return messages.some(
    (msg) =>
      msg.type === "tool" && msg.name && communicationTools.includes(msg.name),
  );
}

/**
 * Check if the model is confirming completion.
 */
export function checkIfConfirmingCompletion(messages: BaseMessage[]): boolean {
  return messages.some(
    (msg) => msg.type === "tool" && msg.name === "confirming_completion",
  );
}

/**
 * Check if the model performed a no-op.
 */
export function checkIfNoOp(messages: BaseMessage[]): boolean {
  return messages.some((msg) => msg.type === "tool" && msg.name === "no_op");
}

/**
 * Result from ensuring no empty message.
 */
export interface EnsureNoEmptyMsgResult {
  messages: BaseMessage[];
}

/**
 * Middleware that ensures the model always produces meaningful output.
 *
 * If the last message has no tool calls and no content, inject a no_op tool call.
 * If the last message has content but no tool calls (and hasn't completed), inject
 * a confirming_completion tool call.
 *
 * @param state - The current agent state
 * @returns Updated messages if intervention needed, null otherwise
 */
export function ensureNoEmptyMsg(
  state: AgentState,
): EnsureNoEmptyMsgResult | null {
  const lastMsg = state.messages[state.messages.length - 1];

  if (!lastMsg) {
    return null;
  }

  const hasContents = Boolean(lastMsg.text?.() || lastMsg.content);
  const hasToolCalls = Boolean(
    lastMsg.tool_calls && lastMsg.tool_calls.length > 0,
  );

  // Case 1: No tool calls and no content
  if (!hasToolCalls && !hasContents) {
    const messagesSinceLastHuman = getEveryMessageSinceLastHuman(state);

    if (checkIfNoOp(messagesSinceLastHuman)) {
      return null;
    }

    if (
      checkIfModelAlreadyCalledCommitAndOpenPr(messagesSinceLastHuman) &&
      checkIfModelMessagedUser(messagesSinceLastHuman)
    ) {
      return null;
    }

    const tcId = uuidv4();
    const noOpToolCall: ToolCall = {
      name: "no_op",
      args: {},
      id: tcId,
    };

    const noOpToolMsg: BaseMessage = {
      type: "tool",
      content:
        "No operation performed." +
        "Please continue with the task, ensuring you ALWAYS call at least one tool in" +
        " every message unless you are absolutely sure the task has been fully completed.",
      name: "no_op",
      tool_calls: [],
    };

    // Update the last message with the tool call
    const updatedLastMsg = {
      ...lastMsg,
      tool_calls: [noOpToolCall],
    };

    return {
      messages: [updatedLastMsg, noOpToolMsg],
    };
  }

  // Case 2: Has content but no tool calls
  if (hasContents && !hasToolCalls) {
    const messagesSinceLastHuman = getEveryMessageSinceLastHuman(state);

    if (
      checkIfModelAlreadyCalledCommitAndOpenPr(messagesSinceLastHuman) ||
      checkIfModelMessagedUser(messagesSinceLastHuman) ||
      checkIfConfirmingCompletion(messagesSinceLastHuman)
    ) {
      return null;
    }

    const tcId = uuidv4();
    const confirmingCompletionToolCall: ToolCall = {
      name: "confirming_completion",
      args: {},
      id: tcId,
    };

    const confirmingCompletionMsg: BaseMessage = {
      type: "tool",
      content:
        "Confirming task completion. I see you did not call a tool, which would end the task, however you haven't called a tool to message the user or open a pull request." +
        "This may indicate premature termination - please ensure you fully complete the task before ending it. " +
        "If you do not call any tools it will end the task.",
      name: "confirming_completion",
      tool_calls: [],
    };

    // Update the last message with the tool call
    const updatedLastMsg = {
      ...lastMsg,
      tool_calls: [confirmingCompletionToolCall],
    };

    return {
      messages: [updatedLastMsg, confirmingCompletionMsg],
    };
  }

  return null;
}

/**
 * Higher-order function that wraps a LangGraph node to ensure no empty messages.
 *
 * Usage:
 * ```ts
 * const wrappedNode = withEnsureNoEmptyMsg(originalNode);
 * graph.addNode("myNode", wrappedNode);
 * ```
 */
export function withEnsureNoEmptyMsg<TState extends AgentState>(
  nodeFn: (state: TState) => Promise<Partial<TState>>,
): (state: TState) => Promise<Partial<TState>> {
  return async (state: TState) => {
    const result = await nodeFn(state);

    // Check if we need to ensure no empty message
    const intervention = ensureNoEmptyMsg(state);
    if (intervention) {
      return {
        ...result,
        messages: intervention.messages,
      } as Partial<TState>;
    }

    return result;
  };
}

/**
 * Create a DeepAgents-compatible middleware that ensures the model
 * always produces meaningful output (tool calls or content).
 *
 * Pass this to `createDeepAgent({ middleware: [createEnsureNoEmptyMsgMiddleware()] })`.
 */
export function createEnsureNoEmptyMsgMiddleware() {
  return createMiddleware({
    name: "ensureNoEmptyMsgMiddleware",

    wrapModelCall: async (request: any, handler: any) => {
      const response = await handler(request);

      // Inspect the model's response for empty output
      const messages = response?.messages || response?.content
        ? [response]
        : [];

      if (messages.length === 0) {
        return response;
      }

      const lastMsg = messages[messages.length - 1];
      const hasContents = Boolean(
        lastMsg?.content ||
        (typeof lastMsg?.text === "function" && lastMsg.text())
      );
      const hasToolCalls = Boolean(
        lastMsg?.tool_calls && lastMsg.tool_calls.length > 0
      );

      // If the model produced tool calls or content, no intervention needed
      if (hasToolCalls || hasContents) {
        return response;
      }

      // Model produced empty output — log and let the model retry naturally
      logger.warn(
        "[ensure-no-empty-msg] Model produced empty output, relying on agent loop to recover",
      );

      return response;
    },
  });
}

