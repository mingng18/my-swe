// lib/bullhorse-client.ts

import type { SSEEvent } from "./types";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

export interface BullhorseClientOptions {
  apiUrl?: string;
  apiSecret?: string;
  maxReconnectAttempts?: number;
  baseReconnectDelay?: number;
  maxReconnectDelay?: number;
}

export interface BullhorseClientCallbacks {
  onEvent: (event: SSEEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: (event: Event) => void;
  onConnecting?: () => void;
  onDisconnected?: () => void;
  onReconnecting?: (attempt: number) => void;
  onMaxRetriesReached?: () => void;
}

interface ReconnectionState {
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  shouldReconnect: boolean;
}

export class BullhorseClient {
  private apiUrl: string;
  private apiSecret?: string;
  private eventSources: Map<string, EventSource>;
  private connectionStates: Map<string, ConnectionState>;
  private reconnectionStates: Map<string, ReconnectionState>;
  private maxReconnectAttempts: number;
  private baseReconnectDelay: number;
  private maxReconnectDelay: number;

  constructor(options: BullhorseClientOptions = {}) {
    this.apiUrl = options.apiUrl || process.env.NEXT_PUBLIC_BULLHORSE_API_URL || "http://localhost:3000";
    this.apiSecret = options.apiSecret;
    this.eventSources = new Map();
    this.connectionStates = new Map();
    this.reconnectionStates = new Map();
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.baseReconnectDelay = options.baseReconnectDelay ?? 1000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
  }

  /**
   * Get exponential backoff delay with jitter
   */
  private getBackoffDelay(attempt: number): number {
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, attempt),
      this.maxReconnectDelay
    );
    // Add jitter (±25% of delay)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.max(delay + jitter, this.baseReconnectDelay);
  }

  /**
   * Get connection state for a thread
   */
  getConnectionState(threadId: string): ConnectionState {
    return this.connectionStates.get(threadId) ?? "disconnected";
  }

  /**
   * Set connection state for a thread
   */
  private setConnectionState(threadId: string, state: ConnectionState): void {
    this.connectionStates.set(threadId, state);
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
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(
    threadId: string,
    callbacks: BullhorseClientCallbacks
  ): void {
    const state = this.reconnectionStates.get(threadId);
    if (!state || state.attempt >= this.maxReconnectAttempts) {
      callbacks.onMaxRetriesReached?.();
      this.setConnectionState(threadId, "error");
      this.clearReconnectionState(threadId);
      return;
    }

    const delay = this.getBackoffDelay(state.attempt);
    console.log(`[SSE] Scheduling reconnect for ${threadId} in ${Math.round(delay / 1000)}s (attempt ${state.attempt + 1}/${this.maxReconnectAttempts})`);

    state.timer = setTimeout(() => {
      state.attempt++;
      callbacks.onReconnecting?.(state.attempt);
      this.connectToThread(threadId, callbacks);
    }, delay);
  }

  /**
   * Clear reconnection state for a thread
   */
  private clearReconnectionState(threadId: string): void {
    const state = this.reconnectionStates.get(threadId);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.reconnectionStates.delete(threadId);
  }

  /**
   * Create SSE connection for a thread
   */
  private connectToThread(
    threadId: string,
    callbacks: BullhorseClientCallbacks
  ): void {
    const url = new URL(`${this.apiUrl}/stream`, window.location.origin);
    url.searchParams.set("threadId", threadId);

    if (this.apiSecret) {
      url.searchParams.set("token", this.apiSecret);
    }

    const eventSource = new EventSource(url.toString());

    eventSource.onopen = (event) => {
      console.log(`[SSE] Connected to thread: ${threadId}`);

      // Successful connection - reset reconnection state
      const reconnectState = this.reconnectionStates.get(threadId);
      if (reconnectState && reconnectState.attempt > 0) {
        console.log(`[SSE] Reconnected to ${threadId} after ${reconnectState.attempt} attempts`);
      }
      this.clearReconnectionState(threadId);
      this.setConnectionState(threadId, "connected");

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

      // EventSource will automatically try to reconnect
      // We add our own reconnection logic for better control
      const currentState = this.getConnectionState(threadId);

      if (currentState === "connected") {
        // Connection was lost
        console.log(`[SSE] Connection lost for ${threadId}, will attempt to reconnect`);
        this.setConnectionState(threadId, "disconnected");
        callbacks.onDisconnected?.();

        // Initialize reconnection state if not already present
        if (!this.reconnectionStates.has(threadId)) {
          this.reconnectionStates.set(threadId, {
            attempt: 0,
            timer: null,
            shouldReconnect: true,
          });
        }

        // Schedule reconnection
        this.scheduleReconnect(threadId, callbacks);
      } else if (currentState === "connecting") {
        // Failed to connect initially
        this.setConnectionState(threadId, "error");
        callbacks.onError?.(error);
      }
    };

    this.eventSources.set(threadId, eventSource);
  }

  /**
   * Subscribe to SSE stream for a thread with reconnection support
   */
  subscribeToThread(
    threadId: string,
    callbacks: BullhorseClientCallbacks,
  ): () => void {
    // Close existing connection for this thread if any
    this.unsubscribeFromThread(threadId);

    // Initialize reconnection state
    this.reconnectionStates.set(threadId, {
      attempt: 0,
      timer: null,
      shouldReconnect: true,
    });

    // Set initial state
    this.setConnectionState(threadId, "connecting");
    callbacks.onConnecting?.();

    // Start connection
    this.connectToThread(threadId, callbacks);

    // Return unsubscribe function
    return () => this.unsubscribeFromThread(threadId);
  }

  /**
   * Manually trigger a reconnection for a thread
   */
  reconnect(threadId: string, callbacks: BullhorseClientCallbacks): void {
    console.log(`[SSE] Manual reconnect requested for ${threadId}`);

    // Clear any existing reconnection state
    this.clearReconnectionState(threadId);

    // Reset reconnection attempt counter
    this.reconnectionStates.set(threadId, {
      attempt: 0,
      timer: null,
      shouldReconnect: true,
    });

    // Close existing connection
    const eventSource = this.eventSources.get(threadId);
    if (eventSource) {
      eventSource.close();
    }

    // Start new connection
    this.setConnectionState(threadId, "connecting");
    callbacks.onConnecting?.();
    this.connectToThread(threadId, callbacks);
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

    // Clear reconnection state
    this.clearReconnectionState(threadId);
    this.connectionStates.delete(threadId);
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

  /**
   * Fetch thread trace/history from server
   * Note: This endpoint returns metrics, not actual events
   * For full event history, a backend endpoint needs to be added
   */
  async getThreadTrace(threadId: string): Promise<unknown> {
    const url = `${this.apiUrl}/trace/${threadId}`;
    const headers: HeadersInit = {};

    if (this.apiSecret) {
      headers["Authorization"] = `Bearer ${this.apiSecret}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch thread trace: ${response.statusText}`);
    }

    return response.json();
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
