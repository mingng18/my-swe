/**
 * Before-model middleware that injects queued messages into state.
 *
 * Checks the LangGraph store for pending messages (e.g. follow-up Linear
 * comments that arrived while the agent was busy) and injects them as new
 * human messages before the next model call.
 */

import { Client } from "@langchain/langgraph-sdk";
import { createLogger } from "../utils/logger";
import { buildBlocksFromPayload, type ContentBlock } from "../utils/multimodal";

const logger = createLogger("check-message-queue");

/**
 * Extended agent state for tracking Linear notifications.
 */
export interface LinearNotifyState {
  linear_messages_sent_count: number;
}

/**
 * Queued message structure from the store.
 */
export interface QueuedMessage {
  role: string;
  content: string | ContentBlock[] | { text?: string; image_urls?: string[] };
}

/**
 * Store item structure for pending messages.
 */
export interface PendingMessagesValue {
  messages: QueuedMessage[];
}

/**
 * Result from checking the message queue.
 */
export interface QueueCheckResult {
  messages: Array<{ role: string; content: ContentBlock[] | string }>;
}

/**
 * Middleware that checks for queued messages before each model call.
 *
 * If messages are found in the queue for this thread, it extracts all messages,
 * adds them to the conversation state as new human messages, and clears the queue.
 * Messages are processed in FIFO order (oldest first).
 *
 * This enables handling of follow-up comments that arrive while the agent is busy.
 * The agent will see the new messages and can incorporate them into its response.
 *
 * @param threadId - The thread ID to check for queued messages
 * @param client - Optional LangGraph SDK client for store operations
 * @returns Object with messages array if queued messages found, null otherwise
 */
export async function checkMessageQueueBeforeModel(
  threadId: string,
  client?: Client,
): Promise<QueueCheckResult | null> {
  try {
    if (!threadId) {
      return null;
    }

    // If no client provided, skip store operations
    if (!client) {
      logger.debug("No store client provided, skipping message queue check");
      return null;
    }

    const namespace = ["queue", threadId];

    try {
      // Get pending messages from store
      const queuedItem = await client.store.getItem(
        namespace,
        "pending_messages",
      );

      if (!queuedItem) {
        return null;
      }

      const queuedValue = queuedItem.value as PendingMessagesValue;
      const queuedMessages = queuedValue.messages || [];

      // Delete early to prevent duplicate processing if middleware runs again
      await client.store.deleteItem(namespace, "pending_messages");

      if (!queuedMessages || queuedMessages.length === 0) {
        return null;
      }

      logger.info(
        {
          threadId,
          count: queuedMessages.length,
        },
        "Found queued message(s), injecting into state",
      );

      const contentBlocks: ContentBlock[] = [];

      for (const msg of queuedMessages) {
        const content = msg.content;

        // Handle payload with text + image URLs
        if (
          typeof content === "object" &&
          content !== null &&
          !Array.isArray(content) &&
          ("text" in content || "image_urls" in content)
        ) {
          logger.debug("Queued message contains text + image URLs");
          const blocks = await buildBlocksFromPayload(content);
          contentBlocks.push(...blocks);
          continue;
        }

        // Handle array of content blocks
        if (Array.isArray(content)) {
          logger.debug(
            `Queued message contains ${content.length} content block(s)`,
          );
          contentBlocks.push(...content);
          continue;
        }

        // Handle plain string content
        if (typeof content === "string" && content) {
          logger.debug("Queued message contains text content");
          contentBlocks.push({ type: "text", text: content });
        }
      }

      if (contentBlocks.length === 0) {
        return null;
      }

      const newMessage = {
        role: "user",
        content: contentBlocks,
      };

      logger.info(
        {
          threadId,
          blockCount: contentBlocks.length,
        },
        "Injected queued message(s) into state",
      );

      return { messages: [newMessage] };
    } catch (error) {
      logger.warn({ error }, "Failed to get queued item");
      return null;
    }
  } catch (error) {
    logger.error(error, "Error in checkMessageQueueBeforeModel");
    return null;
  }
}

/**
 * Higher-order function that wraps a LangGraph node to check for queued messages
 * before executing the node's logic.
 *
 * Usage:
 * ```ts
 * const wrappedNode = withMessageQueueCheck(originalNode);
 * graph.addNode("myNode", wrappedNode);
 * ```
 */
export function withMessageQueueCheck<TState extends Record<string, unknown>>(
  nodeFn: (state: TState) => Promise<Partial<TState>>,
  config?: { client?: Client },
): (state: TState) => Promise<Partial<TState>> {
  return async (state: TState) => {
    const configurable = (
      state as unknown as { configurable?: Record<string, unknown> }
    ).configurable;
    const threadId = configurable?.thread_id as string | undefined;

    if (threadId) {
      const queuedResult = await checkMessageQueueBeforeModel(
        threadId,
        config?.client,
      );

      if (queuedResult && queuedResult.messages.length > 0) {
        // Merge queued messages into state
        const existingMessages =
          (state as unknown as { messages?: unknown[] }).messages || [];
        return {
          ...state,
          messages: [...existingMessages, ...queuedResult.messages],
        };
      }
    }

    return nodeFn(state);
  };
}
