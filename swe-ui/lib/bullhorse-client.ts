// lib/bullhorse-client.ts

import type { SSEEvent } from "./types";

export interface BullhorseClientOptions {
  apiUrl?: string;
  apiSecret?: string;
}

export class BullhorseClient {
  private apiUrl: string;
  private apiSecret?: string;
  private eventSources: Map<string, EventSource>;

  constructor(options: BullhorseClientOptions = {}) {
    this.apiUrl = options.apiUrl || process.env.NEXT_PUBLIC_BULLHORSE_API_URL || "http://localhost:7860";
    this.apiSecret = options.apiSecret;
    this.eventSources = new Map();
  }

  /**
   * Start a new agent run
   */
  async startRun(input: string, threadId?: string): Promise<{
    threadId: string;
    status: string;
  }> {
    const url = `${this.apiUrl}/run`;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (this.apiSecret) {
      headers["Authorization"] = `Bearer ${this.apiSecret}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input,
        threadId: threadId || undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to start run: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Subscribe to SSE stream for a thread
   */
  subscribeToThread(
    threadId: string,
    callbacks: {
      onEvent: (event: SSEEvent) => void;
      onError?: (error: Event) => void;
      onOpen?: (event: Event) => void;
    },
  ): () => void {
    // Close existing connection for this thread if any
    this.unsubscribeFromThread(threadId);

    const url = new URL(`${this.apiUrl}/stream`, window.location.origin);
    url.searchParams.set("threadId", threadId);

    if (this.apiSecret) {
      url.searchParams.set("token", this.apiSecret);
    }

    const eventSource = new EventSource(url.toString());

    eventSource.onopen = (event) => {
      console.log(`[SSE] Connected to thread: ${threadId}`);
      callbacks.onOpen?.(event);
    };

    eventSource.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as SSEEvent;
        callbacks.onEvent(event);
      } catch (error) {
        console.error("[SSE] Failed to parse event:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error(`[SSE] Error for thread ${threadId}:`, error);
      callbacks.onError?.(error);
    };

    this.eventSources.set(threadId, eventSource);

    // Return unsubscribe function
    return () => this.unsubscribeFromThread(threadId);
  }

  /**
   * Unsubscribe from a thread's SSE stream
   */
  unsubscribeFromThread(threadId: string): void {
    const eventSource = this.eventSources.get(threadId);
    if (eventSource) {
      eventSource.close();
      this.eventSources.delete(threadId);
      console.log(`[SSE] Disconnected from thread: ${threadId}`);
    }
  }

  /**
   * Unsubscribe from all threads
   */
  unsubscribeAll(): void {
    const threadIds = Array.from(this.eventSources.keys());
    for (const threadId of threadIds) {
      this.unsubscribeFromThread(threadId);
    }
  }
}

// Singleton instance
let clientInstance: BullhorseClient | null = null;

export function getBullhorseClient(options?: BullhorseClientOptions): BullhorseClient {
  if (!clientInstance) {
    clientInstance = new BullhorseClient(options);
  }
  return clientInstance;
}
