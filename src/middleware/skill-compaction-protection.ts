import { createLogger } from "../utils/logger";
import { createMiddleware } from "langchain";

const logger = createLogger("skill-compaction-protection");

/**
 * Create middleware that protects skill content from context compaction.
 *
 * When a skill is activated via the activate_skill tool, the response contains
 * the full skill content wrapped in <skill_content> tags. This middleware
 * intercepts those messages and flags them with _protected: true to prevent
 * them from being removed during context compaction.
 *
 * The protection is applied by:
 * 1. Wrapping model calls to intercept responses
 * 2. Detecting messages containing <skill_content tags
 * 3. Adding _protected: true flag to those messages
 * 4. Ensuring protected messages are preserved during compaction
 *
 * This is critical because skill content often contains detailed instructions
 * that should remain available throughout the conversation, even when context
 * grows large and compaction is triggered.
 */
export function createSkillCompactionProtectionMiddleware() {
  return createMiddleware({
    name: "skillCompactionProtection",

    wrapModelCall: async (request: any, handler: any) => {
      try {
        // Call the original model
        const response = await handler(request);

        // Check if response contains tool results with skill content
        const messages = response.messages || [];
        let protectionCount = 0;

        for (const message of messages) {
          // Check if this is a tool result message
          if (message.type === "tool" || message.type === "tool-result") {
            const content = message.content;

            // Check for skill content in the response
            let hasSkillContent = false;

            if (typeof content === "string") {
              hasSkillContent = content.includes("<skill_content");
            } else if (Array.isArray(content)) {
              // Handle array content blocks
              for (const block of content) {
                if (block.type === "text" && block.text) {
                  if (block.text.includes("<skill_content")) {
                    hasSkillContent = true;
                    break;
                  }
                }
              }
            }

            // Flag messages with skill content as protected
            if (hasSkillContent) {
              // Add protected flag using additional_kwargs
              if (!message.additional_kwargs) {
                message.additional_kwargs = {};
              }
              message.additional_kwargs._protected = true;
              protectionCount++;

              logger.debug(
                {
                  toolCallId: message.tool_call_id,
                  contentLength: JSON.stringify(content).length,
                },
                "[skill-compaction-protection] Protected skill content message"
              );
            }
          }
        }

        if (protectionCount > 0) {
          logger.info(
            { protectionCount },
            "[skill-compaction-protection] Protected skill content messages from compaction"
          );
        }

        return response;
      } catch (error) {
        logger.error(
          { error },
          "[skill-compaction-protection] Error in model call wrapper"
        );
        // Re-throw to maintain normal error flow
        throw error;
      }
    },
  });
}

/**
 * Check if a message is protected from compaction.
 *
 * Messages are protected if they have the _protected flag set to true.
 * This is typically set by the skill compaction protection middleware.
 *
 * @param message - The message to check
 * @returns true if the message is protected from compaction
 */
export function isMessageProtected(message: any): boolean {
  return (
    message?.additional_kwargs?._protected === true ||
    message?.kwargs?._protected === true
  );
}

/**
 * Filter protected messages from an array.
 *
 * Returns only messages that are NOT protected, useful for compaction
 * operations that should skip protected messages.
 *
 * @param messages - Array of messages to filter
 * @returns Array of unprotected messages
 */
export function filterProtectedMessages(messages: any[]): any[] {
  return messages.filter((msg) => !isMessageProtected(msg));
}

/**
 * Get all protected messages from an array.
 *
 * Returns only messages that ARE protected, useful for preserving
 * critical content during compaction.
 *
 * @param messages - Array of messages to filter
 * @returns Array of protected messages
 */
export function getProtectedMessages(messages: any[]): any[] {
  return messages.filter((msg) => isMessageProtected(msg));
}
