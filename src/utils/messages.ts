import { type BaseMessage } from "@langchain/core/messages";

/**
 * Type guard or helper to check if a message is a tool message.
 * Handles both the role and type properties for robust checking.
 */
export function isToolMessage(msg: Record<string, any> | BaseMessage): boolean {
  if (!msg) return false;
  return msg.type === "tool" || msg.role === "tool";
}
