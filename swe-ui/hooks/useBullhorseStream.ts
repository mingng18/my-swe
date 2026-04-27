// hooks/useBullhorseStream.ts

"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useThreadStore } from "@/store/thread-store";
import { getBullhorseClient, type ConnectionState } from "@/lib/bullhorse-client";
import type { SSEEvent, Todo } from "@/lib/types";
import { useToast } from "@/components/ui/toast";

export interface UseBullhorseStreamOptions {
  threadId: string;
  enabled?: boolean;
}

/**
 * Storage key prefix for session-based event history
 * This allows us to restore events when reconnecting to a thread
 */
const EVENT_STORAGE_PREFIX = "bullhorse_events_";

/**
 * Save events to sessionStorage for history restoration on reconnect
 */
function saveEventsToStorage(threadId: string, events: SSEEvent[]): void {
  try {
    const key = `${EVENT_STORAGE_PREFIX}${threadId}`;
    sessionStorage.setItem(key, JSON.stringify(events));
  } catch (error) {
    console.error("[useBullhorseStream] Failed to save events to storage:", error);
  }
}

/**
 * Load events from sessionStorage for history restoration
 */
function loadEventsFromStorage(threadId: string): SSEEvent[] {
  try {
    const key = `${EVENT_STORAGE_PREFIX}${threadId}`;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as SSEEvent[];
    }
  } catch (error) {
    console.error("[useBullhorseStream] Failed to load events from storage:", error);
  }
  return [];
}

/**
 * Clear events from sessionStorage
 */
function clearEventsFromStorage(threadId: string): void {
  try {
    const key = `${EVENT_STORAGE_PREFIX}${threadId}`;
    sessionStorage.removeItem(key);
  } catch (error) {
    console.error("[useBullhorseStream] Failed to clear events from storage:", error);
  }
}

export function useBullhorseStream({
  threadId,
  enabled = true,
}: UseBullhorseStreamOptions) {
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const connectionStateRef = useRef<ConnectionState>("disconnected");
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [showReconnectingBanner, setShowReconnectingBanner] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);
  const { addThread, addEvent, updateTodo, updateThread, threads } = useThreadStore();
  const { addToast } = useToast();

  // Update ref when state changes
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  const handleEvent = useCallback((event: SSEEvent) => {
    console.log(`[useBullhorseStream] Received event for ${threadId}:`, event.type, event);
    // Add event to thread
    addEvent(threadId, event);

    // Persist events to sessionStorage for history restoration on reconnect
    const thread = threads[threadId];
    if (thread) {
      saveEventsToStorage(threadId, thread.events);
    }

    // Handle todo events separately
    if (event.type === "todo_added") {
      const todo: Todo = {
        id: event.id,
        subject: event.subject,
        status: event.status,
      };
      updateTodo(threadId, todo);
    } else if (event.type === "todo_updated") {
      const currentThread = useThreadStore.getState().threads[threadId];
      if (currentThread) {
        const existingTodo = currentThread.todos.find((t) => t.id === event.id);
        if (existingTodo) {
          updateTodo(threadId, {
            ...existingTodo,
            status: event.status,
          });
        }
      }
    } else if (event.type === "todo_completed") {
      const currentThread = useThreadStore.getState().threads[threadId];
      if (currentThread) {
        const todo = currentThread.todos.find((t) => t.id === event.id);
        if (todo) {
          updateTodo(threadId, { ...todo, status: "completed" });
        }
      }
    }

    // Handle error events
    if (event.type === "error") {
      setSseError(event.message);
      updateThread(threadId, {
        status: "error",
        error: event.message,
      });
    }
  }, [threadId, addEvent, updateTodo, updateThread, threads, addToast]);

  const handleReconnect = useCallback(async () => {
    console.log(`[useBullhorseStream] Attempting to restore thread history for ${threadId}`);

    try {
      // Try to restore events from sessionStorage
      const storedEvents = loadEventsFromStorage(threadId);
      if (storedEvents.length > 0) {
        console.log(`[useBullhorseStream] Restored ${storedEvents.length} events from session storage`);

        // Add stored events to the thread
        const currentThread = threads[threadId];
        if (currentThread) {
          // Only add events that aren't already in the thread
          // Use index as part of ID since not all events have timestamps
          const existingEventIds = new Set(currentThread.events.map((e, i) => `${e.type}-${i}`));
          let addedCount = 0;

          for (let i = 0; i < storedEvents.length; i++) {
            const event = storedEvents[i];
            // Generate a unique ID for the event based on type and index
            const eventId = `${event.type}-${i}`;
            if (!existingEventIds.has(eventId)) {
              addEvent(threadId, event);
              addedCount++;
            }
          }

          if (addedCount > 0) {
            console.log(`[useBullhorseStream] Added ${addedCount} historical events to thread`);
          }
        }
      } else {
        console.log("[useBullhorseStream] No stored events found for thread");
      }

      // TODO: The /trace endpoint returns metrics, not actual events
      // For full event history from the server, a backend endpoint needs to be added
      // that returns the complete SSE event history for a thread.
      // See: https://github.com/your-repo/issues/XXX
    } catch (error) {
      console.error("[useBullhorseStream] Failed to restore thread history:", error);
    }
  }, [threadId, threads, addEvent]);

  useEffect(() => {
    if (!enabled) {
      console.log(`[useBullhorseStream] SSE disabled for thread: ${threadId}`);
      return;
    }

    console.log(`[useBullhorseStream] Subscribing to SSE for thread: ${threadId}`);

    // Add thread to store if it doesn't exist
    const existingThread = useThreadStore.getState().threads[threadId];
    if (!existingThread) {
      addThread(threadId);
    }

    // Subscribe to SSE stream
    const client = getBullhorseClient();
    unsubscribeRef.current = client.subscribeToThread(threadId, {
      onEvent: handleEvent,
      onOpen: () => {
        console.log(`[useBullhorseStream] SSE connection opened for thread: ${threadId}`);
        const previousState = connectionStateRef.current;
        setConnectionState("connected");
        setShowReconnectingBanner(false);
        setSseError(null);
        updateThread(threadId, { status: "running", error: undefined });

        // Show reconnected toast if this was a reconnection
        if (previousState === "connecting" && reconnectAttempt > 0) {
          console.log(`[useBullhorseStream] Reconnected to ${threadId}`);
          addToast({
            title: "Reconnected",
            description: "Connection to server restored",
            variant: "success",
            duration: 3000,
          });
          handleReconnect();
        }
      },
      onError: (error) => {
        console.error(`[useBullhorseStream] Error for ${threadId}:`, error);
        setConnectionState("error");
        updateThread(threadId, { status: "error" });
      },
      onConnecting: () => {
        setConnectionState("connecting");
      },
      onDisconnected: () => {
        setConnectionState("disconnected");
        setShowReconnectingBanner(true);
      },
      onReconnecting: (attempt) => {
        setReconnectAttempt(attempt);
        setConnectionState("connecting");
      },
      onMaxRetriesReached: () => {
        setConnectionState("error");
        setShowReconnectingBanner(false);
        updateThread(threadId, {
          status: "error",
          error: "Connection failed after multiple retry attempts",
        });
      },
    });

    // Cleanup on unmount
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
        setConnectionState("disconnected");
        setShowReconnectingBanner(false);
      }
    };
  }, [threadId, enabled, handleEvent, addThread, updateThread, handleReconnect]);

  const manualReconnect = useCallback(() => {
    const client = getBullhorseClient();
    setReconnectAttempt(0);
    setShowReconnectingBanner(false);
    setSseError(null);

    client.reconnect(threadId, {
      onEvent: handleEvent,
      onOpen: () => {
        setConnectionState("connected");
        setSseError(null);
        updateThread(threadId, { status: "running", error: undefined });
        addToast({
          title: "Reconnected",
          description: "Connection to server restored",
          variant: "success",
          duration: 3000,
        });
        handleReconnect();
      },
      onError: (error) => {
        console.error(`[useBullhorseStream] Error during manual reconnect:`, error);
        setConnectionState("error");
      },
      onConnecting: () => {
        setConnectionState("connecting");
      },
    });
  }, [threadId, handleEvent, updateThread, handleReconnect, addToast]);

  return {
    isConnected: connectionState === "connected",
    connectionState,
    reconnectAttempt,
    showReconnectingBanner,
    sseError,
    manualReconnect,
    clearError: () => setSseError(null),
  };
}
