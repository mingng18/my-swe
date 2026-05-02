// lib/types.ts

export interface Todo {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  description?: string;
}

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

export type ThreadStatus = "idle" | "running" | "completed" | "error";

export interface ThreadState {
  threadId: string;
  status: ThreadStatus;
  events: SSEEvent[];
  todos: Todo[];
  startTime: number;
  endTime?: number;
  error?: string;
}

export interface AppState {
  threads: Record<string, ThreadState>;
  activeThreadId: string | null;
}
