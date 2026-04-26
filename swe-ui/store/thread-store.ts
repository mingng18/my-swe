// store/thread-store.ts

import { create } from "zustand";
import type { ThreadState, SSEEvent, Todo } from "@/lib/types";

interface ThreadStore {
  threads: Record<string, ThreadState>;
  activeThreadId: string | null;

  // Actions
  setActiveThread: (threadId: string | null) => void;
  addThread: (threadId: string) => void;
  removeThread: (threadId: string) => void;
  updateThread: (threadId: string, updates: Partial<ThreadState>) => void;
  addEvent: (threadId: string, event: SSEEvent) => void;
  updateTodo: (threadId: string, todo: Todo) => void;
  getThread: (threadId: string) => ThreadState | undefined;
}

export const useThreadStore = create<ThreadStore>((set, get) => ({
  threads: {},
  activeThreadId: null,

  setActiveThread: (threadId) =>
    set({
      activeThreadId: threadId,
    }),

  addThread: (threadId) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [threadId]: {
          threadId,
          status: "running",
          events: [],
          todos: [],
          startTime: Date.now(),
        },
      },
      activeThreadId: state.activeThreadId || threadId,
    })),

  removeThread: (threadId) =>
    set((state) => {
      const newThreads = { ...state.threads };
      delete newThreads[threadId];
      return {
        threads: newThreads,
        activeThreadId:
          state.activeThreadId === threadId ? null : state.activeThreadId,
      };
    }),

  updateThread: (threadId, updates) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [threadId]: {
          ...state.threads[threadId],
          ...updates,
        },
      },
    })),

  addEvent: (threadId, event) =>
    set((state) => {
      const thread = state.threads[threadId];
      if (!thread) return state;

      const newEvents = [...thread.events, event];
      const status = event.type === "session_end" ? "completed" : thread.status;
      const endTime =
        event.type === "session_end"
          ? event.timestamp
          : thread.endTime;

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...thread,
            events: newEvents,
            status,
            endTime,
          },
        },
      };
    }),

  updateTodo: (threadId, todo) =>
    set((state) => {
      const thread = state.threads[threadId];
      if (!thread) return state;

      const existingTodoIndex = thread.todos.findIndex((t) => t.id === todo.id);
      let newTodos: Todo[];

      if (existingTodoIndex >= 0) {
        newTodos = [...thread.todos];
        newTodos[existingTodoIndex] = todo;
      } else {
        newTodos = [...thread.todos, todo];
      }

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...thread,
            todos: newTodos,
          },
        },
      };
    }),

  getThread: (threadId) => {
    return get().threads[threadId];
  },
}));
