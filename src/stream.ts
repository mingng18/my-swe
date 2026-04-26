import { createLogger } from "./utils/logger";

const logger = createLogger("stream");

// ============================================================================
// SSE Event Type Definitions
// ============================================================================

export interface SessionStartEvent {
  type: "session_start";
  threadId: string;
  timestamp: number;
}

export interface LLMStartEvent {
  type: "llm_start";
  model: string;
  timestamp: number;
}

export interface LLMChunkEvent {
  type: "llm_chunk";
  content: string;
  timestamp: number;
}

export interface LLMEndEvent {
  type: "llm_end";
  totalTokens: number;
  timestamp: number;
}

export interface ToolCallEvent {
  type: "tool_call";
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export interface ToolResultEvent {
  type: "tool_result";
  tool: string;
  result: unknown;
  duration: number;
  timestamp: number;
}

export interface TodoAddedEvent {
  type: "todo_added";
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TodoUpdatedEvent {
  type: "todo_updated";
  id: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TodoCompletedEvent {
  type: "todo_completed";
  id: string;
}

export interface SessionEndEvent {
  type: "session_end";
  threadId: string;
  timestamp: number;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  timestamp: number;
}

export type SSEEvent =
  | SessionStartEvent
  | LLMStartEvent
  | LLMChunkEvent
  | LLMEndEvent
  | ToolCallEvent
  | ToolResultEvent
  | TodoAddedEvent
  | TodoUpdatedEvent
  | TodoCompletedEvent
  | SessionEndEvent
  | ErrorEvent;

// ============================================================================
// SSE Emitter Class
// ============================================================================

export class SSEEmitter {
  private controller: ReadableStreamDefaultController<any> | null = null;
  private encoder = new TextEncoder();

  /**
   * Create a new SSE stream
   */
  createStream(): ReadableStream {
    return new ReadableStream({
      start: (controller) => {
        this.controller = controller;
        logger.debug("[SSE] Stream created");
      },
      cancel: () => {
        this.controller = null;
        logger.debug("[SSE] Stream cancelled");
      },
    });
  }

  /**
   * Emit an event to the SSE stream
   */
  emit(event: SSEEvent): void {
    if (!this.controller) {
      logger.debug("[SSE] No controller, cannot emit event");
      return;
    }

    const data = JSON.stringify(event);
    const message = `data: ${data}\n\n`;
    this.controller.enqueue(this.encoder.encode(message));

    logger.debug(
      { eventType: event.type },
      `[SSE] Emitted event: ${event.type}`,
    );
  }

  /**
   * End the SSE stream
   */
  end(): void {
    if (this.controller) {
      this.controller.close();
      this.controller = null;
      logger.debug("[SSE] Stream ended");
    }
  }

  /**
   * Check if stream is active
   */
  isActive(): boolean {
    return this.controller !== null;
  }
}

// ============================================================================
// Stream Registry
// ============================================================================

interface StreamConnection {
  stream: ReadableStream;
  emitter: SSEEmitter;
  threadId: string;
  createdAt: number;
}

class StreamRegistry {
  private connections = new Map<string, StreamConnection>();

  /**
   * Create a new stream for a thread
   */
  createStream(threadId: string): ReadableStream {
    // Close existing stream for this thread if any
    this.closeStream(threadId);

    const emitter = new SSEEmitter();
    const stream = emitter.createStream();

    this.connections.set(threadId, {
      stream,
      emitter,
      threadId,
      createdAt: Date.now(),
    });

    return stream;
  }

  /**
   * Get emitter for a thread
   */
  getEmitter(threadId: string): SSEEmitter | undefined {
    return this.connections.get(threadId)?.emitter;
  }

  /**
   * Close stream for a thread
   */
  closeStream(threadId: string): void {
    const connection = this.connections.get(threadId);
    if (connection) {
      connection.emitter.end();
      this.connections.delete(threadId);
    }
  }

  /**
   * Clean up old streams (older than 1 hour)
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const [threadId, connection] of this.connections.entries()) {
      if (now - connection.createdAt > maxAge) {
        connection.emitter.end();
        this.connections.delete(threadId);
        logger.debug({ threadId }, "[SSE] Cleaned up old stream");
      }
    }
  }
}

export const streamRegistry = new StreamRegistry();

// Run cleanup every 30 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => streamRegistry.cleanup(), 30 * 60 * 1000);
}
