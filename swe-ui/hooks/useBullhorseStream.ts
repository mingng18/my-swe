// hooks/useBullhorseStream.ts

"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useThreadStore } from "@/store/thread-store";
import { getBullhorseClient } from "@/lib/bullhorse-client";
import type { SSEEvent, Todo } from "@/lib/types";

export interface UseBullhorseStreamOptions {
  threadId: string;
  enabled?: boolean;
}

export function useBullhorseStream({
  threadId,
  enabled = true,
}: UseBullhorseStreamOptions) {
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { addThread, addEvent, updateTodo, updateThread } = useThreadStore();

  const handleEvent = useCallback((event: SSEEvent) => {
    // Add event to thread
    addEvent(threadId, event);

    // Handle todo events separately
    if (event.type === "todo_added") {
      const todo: Todo = {
        id: event.id,
        subject: event.subject,
        status: event.status,
      };
      updateTodo(threadId, todo);
    } else if (event.type === "todo_updated") {
      const thread = useThreadStore.getState().threads[threadId];
      if (thread) {
        const existingTodo = thread.todos.find((t) => t.id === event.id);
        if (existingTodo) {
          updateTodo(threadId, {
            ...existingTodo,
            status: event.status,
          });
        }
      }
    } else if (event.type === "todo_completed") {
      const thread = useThreadStore.getState().threads[threadId];
      if (thread) {
        const todo = thread.todos.find((t) => t.id === event.id);
        if (todo) {
          updateTodo(threadId, { ...todo, status: "completed" });
        }
      }
    }

    // Handle error events
    if (event.type === "error") {
      updateThread(threadId, {
        status: "error",
        error: event.message,
      });
    }
  }, [threadId, addEvent, updateTodo, updateThread]);

  useEffect(() => {
    if (!enabled) return;

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
        setIsConnected(true);
        updateThread(threadId, { status: "running", error: undefined });
      },
      onError: () => {
        setIsConnected(false);
        updateThread(threadId, { status: "error" });
      },
    });

    // Cleanup on unmount
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
        setIsConnected(false);
      }
    };
  }, [threadId, enabled, handleEvent, addThread, updateThread]);

  return {
    isConnected,
  };
}
