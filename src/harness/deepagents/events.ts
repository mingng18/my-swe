import { streamRegistry, type SSEEvent } from "../../stream";

// ============================================================================
// SSE Event Emission Helpers
// ============================================================================

/**
 * Emit an event to the SSE stream for a thread
 * Uses buffering to handle cases where client hasn't connected yet
 */
export function emitStreamEvent(threadId: string, event: SSEEvent): void {
  streamRegistry.emitEvent(threadId, event);
}

/**
 * Emit todo events (called by middleware)
 */
export function emitTodoEvent(
  threadId: string,
  event:
    | { type: "add"; id: string; subject: string; status: string }
    | { type: "update"; id: string; status: string }
    | { type: "complete"; id: string },
): void {
  if (event.type === "add") {
    emitStreamEvent(threadId, {
      type: "todo_added",
      id: event.id,
      subject: event.subject,
      status: event.status as "pending" | "in_progress" | "completed",
    });
  } else if (event.type === "update") {
    emitStreamEvent(threadId, {
      type: "todo_updated",
      id: event.id,
      status: event.status as "pending" | "in_progress" | "completed",
    });
  } else if (event.type === "complete") {
    emitStreamEvent(threadId, {
      type: "todo_completed",
      id: event.id,
    });
  }
}
