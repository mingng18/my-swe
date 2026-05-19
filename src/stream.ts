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
// SSE Stream Controller
// ============================================================================

export class SSEStream {
  private encoder = new TextEncoder();
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private stream: ReadableStream<Uint8Array> | null = null;
  private pendingEvents: SSEEvent[] = [];
  private initialized = false;

  /**
   * Create a new SSE stream
   */
  create(): ReadableStream<Uint8Array> {
    this.stream = new ReadableStream({
      pull: (controller) => {
        if (!this.initialized) {
          this.controller = controller;
          this.initialized = true;
          logger.debug("[SSE] Stream pull called, controller initialized");

          // Send initial comment to establish connection
          try {
            controller.enqueue(this.encoder.encode(": connected\n\n"));
          } catch (error) {
            logger.error({ error }, "[SSE] Failed to send initial comment");
          }

          // Emit any pending events
          while (this.pendingEvents.length > 0) {
            const event = this.pendingEvents.shift();
            if (event) {
              this.emit(event);
            }
          }

          // Start heartbeat every 15 seconds to keep connection alive
          this.heartbeatInterval = setInterval(() => {
            if (this.controller) {
              try {
                controller.enqueue(this.encoder.encode(": heartbeat\n\n"));
                logger.debug("[SSE] Heartbeat sent");
              } catch (error) {
                logger.error({ error }, "[SSE] Failed to send heartbeat");
                this.stopHeartbeat();
              }
            }
          }, 15000);
        }
        // Don't close the stream - let it stay open for SSE
      },
      cancel: () => {
        logger.debug("[SSE] Stream cancelled");
        this.stopHeartbeat();
        this.controller = null;
        this.initialized = false;
      },
    });

    // Keep a reference to prevent garbage collection
    return this.stream;
  }

  /**
   * Emit an event to the SSE stream
   */
  emit(event: SSEEvent): void {
    // If controller isn't ready yet, queue the event
    if (!this.controller || !this.initialized) {
      logger.debug({ eventType: event.type }, "[SSE] Controller not ready, queuing event");
      this.pendingEvents.push(event);
      return;
    }

    try {
      const data = JSON.stringify(event);
      const message = `data: ${data}\n\n`;
      this.controller.enqueue(this.encoder.encode(message));

      logger.debug(
        { eventType: event.type },
        `[SSE] Emitted event: ${event.type}`,
      );
    } catch (error) {
      logger.error({ error }, "[SSE] Failed to emit event");
    }
  }

  /**
   * End the SSE stream
   */
  end(): void {
    this.stopHeartbeat();
    if (this.controller) {
      try {
        this.controller.close();
      } catch (error) {
        logger.error({ error }, "[SSE] Failed to close controller");
      }
      this.controller = null;
    }
    this.stream = null;
    logger.debug("[SSE] Stream ended");
  }

  /**
   * Stop the heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
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
  stream: ReadableStream<Uint8Array>;
  sseStream: SSEStream;
  threadId: string;
  createdAt: number;
  clientConnectedAt?: number;
}

class StreamRegistry {
  private connections = new Map<string, StreamConnection>();
  private eventBuffers = new Map<string, Array<{ event: SSEEvent; timestamp: number }>>();
  private readonly BUFFER_TTL = 5000; // 5 seconds
  private readonly MAX_BUFFER_SIZE = 100; // Max events to buffer per thread

  /**
   * Create a new stream for a thread
   */
  createStream(threadId: string): ReadableStream<Uint8Array> {
    // Close existing stream for this thread if any
    this.closeStream(threadId);

    const sseStream = new SSEStream();
    const stream = sseStream.create();

    this.connections.set(threadId, {
      stream,
      sseStream,
      threadId,
      createdAt: Date.now(),
    });

    logger.debug({ threadId }, "[SSE] Created new stream for thread");

    return stream;
  }

  /**
   * Mark a stream as having a connected client and replay buffered events
   */
  markClientConnected(threadId: string): void {
    const connection = this.connections.get(threadId);
    if (connection && !connection.clientConnectedAt) {
      connection.clientConnectedAt = Date.now();
      logger.debug({ threadId }, "[SSE] Client connected, replaying buffered events");

      // Replay any buffered events
      const buffer = this.eventBuffers.get(threadId);
      if (buffer && buffer.length > 0) {
        const now = Date.now();
        const validEvents = buffer.filter(e => now - e.timestamp < this.BUFFER_TTL);

        logger.debug({ threadId, count: validEvents.length }, "[SSE] Replaying buffered events");

        for (const { event } of validEvents) {
          connection.sseStream.emit(event);
        }

        // Clear the buffer after replaying
        if (validEvents.length === buffer.length) {
          this.eventBuffers.delete(threadId);
        } else {
          this.eventBuffers.set(threadId, validEvents);
        }
      }
    }
  }

  /**
   * Emit an event, buffering it if no client is connected yet
   */
  emitEvent(threadId: string, event: SSEEvent): void {
    const connection = this.connections.get(threadId);

    if (!connection) {
      // No stream exists yet, buffer the event
      this.bufferEvent(threadId, event);
      return;
    }

    const hasClient = connection.clientConnectedAt &&
                        Date.now() - connection.clientConnectedAt < this.BUFFER_TTL;

    if (!hasClient) {
      // Stream exists but client not connected yet, buffer the event
      this.bufferEvent(threadId, event);
      return;
    }

    // Client is connected, emit directly
    connection.sseStream.emit(event);
  }

  /**
   * Buffer an event for later replay
   */
  private bufferEvent(threadId: string, event: SSEEvent): void {
    let buffer = this.eventBuffers.get(threadId);
    if (!buffer) {
      buffer = [];
      this.eventBuffers.set(threadId, buffer);
    }

    // Add event to buffer (with timestamp)
    buffer.push({ event, timestamp: Date.now() });

    // Prune old events and enforce size limit
    const now = Date.now();
    const validEvents = buffer.filter(e => now - e.timestamp < this.BUFFER_TTL);

    if (validEvents.length > this.MAX_BUFFER_SIZE) {
      // Keep only the most recent events
      validEvents.splice(0, validEvents.length - this.MAX_BUFFER_SIZE);
    }

    this.eventBuffers.set(threadId, validEvents);

    logger.debug({ threadId, eventType: event.type, bufferSize: validEvents.length },
                  "[SSE] Buffered event (no client connected)");
  }

  /**
   * Close stream for a thread
   */
  hasActiveStream(threadId: string): boolean {
    const connection = this.connections.get(threadId);
    return connection ? connection.sseStream.isActive() : false;
  }

  /**
   * Close stream for a thread
   */
  closeStream(threadId: string): void {
    const connection = this.connections.get(threadId);
    if (connection) {
      connection.sseStream.end();
      this.connections.delete(threadId);
      // Keep event buffer for potential reconnection
    }
  }

  /**
   * Clean up old streams (older than 1 hour) and their buffers
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const [threadId, connection] of this.connections.entries()) {
      if (now - connection.createdAt > maxAge) {
        connection.sseStream.end();
        this.connections.delete(threadId);
        this.eventBuffers.delete(threadId); // Clean up buffer too
        logger.debug({ threadId }, "[SSE] Cleaned up old stream");
      }
    }

    // Also clean up old event buffers for threads without connections
    for (const [threadId, buffer] of this.eventBuffers.entries()) {
      const hasConnection = this.connections.has(threadId);
      const hasValidEvents = buffer.some(e => now - e.timestamp < this.BUFFER_TTL);

      if (!hasConnection && !hasValidEvents) {
        this.eventBuffers.delete(threadId);
        logger.debug({ threadId }, "[SSE] Cleaned up old event buffer");
      }
    }
  }
}

export const streamRegistry = new StreamRegistry();

// Run cleanup every 30 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => streamRegistry.cleanup(), 30 * 60 * 1000);
}
