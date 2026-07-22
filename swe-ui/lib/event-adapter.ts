// lib/event-adapter.ts

import type { SSEEvent } from "./types";

export interface AdaptedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  metadata?: {
    tool?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    duration?: number;
    model?: string;
    tokens?: number;
    isToolCall?: boolean;
    isToolResult?: boolean;
  };
}

export function adaptEventToMessage(event: SSEEvent): AdaptedMessage | null {
  // Get timestamp from event, defaulting to current time if not present
  const timestamp = "timestamp" in event ? event.timestamp : Date.now();

  const baseMessage = {
    id: `${event.type}-${timestamp}`,
    timestamp,
  };

  switch (event.type) {
    case "llm_start":
      return {
        ...baseMessage,
        role: "assistant",
        content: `🧠 Thinking with ${event.model}...`,
        metadata: {
          model: event.model,
        },
      };

    case "llm_chunk":
      return {
        ...baseMessage,
        role: "assistant",
        content: event.content,
      };

    case "llm_end":
      return {
        ...baseMessage,
        role: "assistant",
        content: `✅ Completed (${event.totalTokens} tokens)`,
        metadata: {
          tokens: event.totalTokens,
        },
      };

    case "tool_call":
      return {
        ...baseMessage,
        role: "assistant",
        content: `🔧 Calling ${event.tool}`,
        metadata: {
          tool: event.tool,
          args: event.args,
          isToolCall: true,
        },
      };

    case "tool_result":
      const resultPreview =
        typeof event.result === "string"
          ? event.result.slice(0, 200) + (event.result.length > 200 ? "..." : "")
          : JSON.stringify(event.result).slice(0, 200) + "...";

      return {
        ...baseMessage,
        role: "assistant",
        content: `✓ ${event.tool} → ${resultPreview}`,
        metadata: {
          tool: event.tool,
          result: event.result,
          duration: event.duration,
          isToolResult: true,
        },
      };

    case "todo_added":
      return {
        ...baseMessage,
        role: "system",
        content: `📋 Added todo: ${event.subject}`,
      };

    case "todo_updated":
      return {
        ...baseMessage,
        role: "system",
        content: `📋 Updated todo: ${event.id}`,
      };

    case "todo_completed":
      return {
        ...baseMessage,
        role: "system",
        content: `✓ Completed todo: ${event.id}`,
      };

    case "error":
      return {
        ...baseMessage,
        role: "system",
        content: `❌ Error: ${event.message}`,
      };

    case "session_start":
    case "session_end":
      return null; // Don't show lifecycle events in timeline

    default:
      return null;
  }
}

export function adaptEventsToMessages(events: SSEEvent[]): AdaptedMessage[] {
  // ⚡ Bolt: Replaced chained .map().filter() with a single-pass for loop
  // to avoid intermediate array allocations and reduce garbage collection pressure.
  const messages: AdaptedMessage[] = [];
  for (let i = 0; i < events.length; i++) {
    const msg = adaptEventToMessage(events[i]);
    if (msg !== null) {
      messages.push(msg);
    }
  }
  return messages;
}

// Group LLM chunks to reduce message count
export function groupLLMChunks(messages: AdaptedMessage[]): AdaptedMessage[] {
  const grouped: AdaptedMessage[] = [];
  let currentChunk: AdaptedMessage | null = null;

  for (const message of messages) {
    if (message.role === "assistant" && !message.metadata?.tool) {
      if (!currentChunk) {
        currentChunk = message;
      } else {
        currentChunk.content += message.content;
        currentChunk.timestamp = message.timestamp;
      }
    } else {
      if (currentChunk) {
        grouped.push(currentChunk);
        currentChunk = null;
      }
      grouped.push(message);
    }
  }

  if (currentChunk) {
    grouped.push(currentChunk);
  }

  return grouped;
}
