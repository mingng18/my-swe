# Bullhorse Agent UI Design

**Date:** 2026-04-26
**Status:** Draft
**Type:** Feature Design

## Overview

A standalone Next.js web application for real-time visualization of Bullhorse agent execution. The UI displays agent thinking processes, tool calls, and todo items through a timeline interface with support for concurrent agent runs.

## Goals

1. **Real-time visibility** - Watch the agent think and act as it happens
2. **Thinking transparency** - See LLM reasoning, not just final outputs
3. **Concurrent monitoring** - Track multiple agent runs simultaneously
4. **Todo awareness** - Always-visible todo panel showing task progress
5. **Timeline context** - Chronological view of tools and thoughts

## Architecture

### Backend Changes (Bullhorse)

#### New SSE Endpoint

**Endpoint:** `GET /stream?threadId=:threadId`

**Response Format:** Server-Sent Events (SSE)

**Event Types:**
```typescript
interface SessionStartEvent {
  type: "session_start";
  threadId: string;
  timestamp: number;
}

interface LLMStartEvent {
  type: "llm_start";
  model: string;
  timestamp: number;
}

interface LLMChunkEvent {
  type: "llm_chunk";
  content: string;
  timestamp: number;
}

interface LLMEndEvent {
  type: "llm_end";
  totalTokens: number;
  timestamp: number;
}

interface ToolCallEvent {
  type: "tool_call";
  tool: string;
  args: object;
  timestamp: number;
}

interface ToolResultEvent {
  type: "tool_result";
  tool: string;
  result: any;
  duration: number;
  timestamp: number;
}

interface TodoAddedEvent {
  type: "todo_added";
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
}

interface TodoUpdatedEvent {
  type: "todo_updated";
  id: string;
  status: "pending" | "in_progress" | "completed";
}

interface TodoCompletedEvent {
  type: "todo_completed";
  id: string;
}

interface SessionEndEvent {
  type: "session_end";
  threadId: string;
  timestamp: number;
}

interface ErrorEvent {
  type: "error";
  message: string;
  timestamp: number;
}

type SSEEvent =
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
```

#### Modified Run Endpoint

**Endpoint:** `POST /run`

**Request:**
```json
{
  "input": "Fix the auth bug",
  "threadId": "optional-thread-id"
}
```

**Response:**
```json
{
  "threadId": "abc123",
  "status": "started"
}
```

#### Implementation Files

- `src/stream.ts` - SSE stream management utilities
- `src/harness/deepagents.ts` - Modify to emit structured events during execution
- `src/webapp.ts` - Add `/stream` endpoint

### Frontend Architecture (Next.js)

#### Tech Stack

- **Next.js 14+** - App Router for modern React patterns
- **AI Elements** - Pre-built AI conversation components
- **shadcn/ui** - Base UI component library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Zustand** - Lightweight state management

#### Project Structure

```
bullhorse-ui/
├── app/
│   ├── page.tsx              # Main monitor page
│   ├── layout.tsx            # Root layout with providers
│   └── api/
│       └── proxy/
│           └── route.ts      # API proxy to Bullhorse (CORS handling)
├── components/
│   ├── ai-elements/          # AI Elements components (installed)
│   ├── ThreadMonitor.tsx     # Main layout container
│   ├── TodoSidebar.tsx       # Always-visible todo panel
│   └── ThreadTabs.tsx        # Tab management for concurrent runs
├── lib/
│   ├── bullhorse-client.ts   # SSE connection manager
│   ├── event-adapter.ts      # Convert SSE events to AI Elements format
│   └── types.ts              # Shared TypeScript types
├── hooks/
│   └── useBullhorseStream.ts # Custom hook for SSE stream
├── store/
│   └── thread-store.ts       # Zustand store for thread state
└── package.json
```

#### State Management

```typescript
// Todo item structure
interface Todo {
  id: string;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed';
  description?: string;
}

// Thread state structure
interface ThreadState {
  threadId: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  events: SSEEvent[];
  todos: Todo[];
  startTime: number;
  endTime?: number;
}

// Global app state (Zustand)
interface AppState {
  threads: Record<string, ThreadState>;
  activeThreadId: string | null;
  setActiveThread: (threadId: string) => void;
  addThread: (thread: ThreadState) => void;
  removeThread: (threadId: string) => void;
  updateThread: (threadId: string, updates: Partial<ThreadState>) => void;
}
```

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ Header: Bullhorse Agent Monitor                          │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────┬───────────────────────────────────────┐ │
│ │             │ Thread Tabs: [Thread-1 ●] [Thread-2] [+]│ │
│ │  TodoPanel  ├───────────────────────────────────────┤ │
│ │  (always    │                                         │ │
│ │   visible)  │        Timeline Stream                 │ │
│ │             │                                         │ │
│ │ ☐ Todo 1   │  ┌─────────────────────────────────┐  │ │
│ │ ☑ Todo 2   │  │ 🧠 Thinking...                  │  │ │
│ │ ☐ Todo 3   │  │ "Let me search for the..."      │  │ │
│ │             │  └─────────────────────────────────┘  │ │
│ │             │                                         │ │
│ │             │  ┌─────────────────────────────────┐  │ │
│ │             │  │ 🔧 code_search                  │  │ │
│ │             │  │ { query: "auth" }               │  │ │
│ │             │  │ → Found 12 files                │  │ │
│ │             │  └─────────────────────────────────┘  │ │
│ │             │                                         │ │
│ │             │  ┌─────────────────────────────────┐  │ │
│ │             │  │ 🧠 Thinking...                  │  │ │
│ │             │  │ "I found the auth module..."    │  │ │
│ │             │  └─────────────────────────────────┘  │ │
│ │             │                                         │ │
│ └─────────────┴───────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Components

#### ThreadMonitor (Main Container)

- Wraps AI Elements `Conversation` component
- Manages SSE connection via `useBullhorseStream`
- Displays active thread's timeline
- Handles error states

#### TodoSidebar (Left Panel)

- Always visible, independent of timeline scrolling
- Checkboxes for each todo with status indicators
- Color coding: gray (pending), blue (in-progress), green (completed)
- Auto-highlights active/in-progress todo
- Collapsible for screen real estate

#### ThreadTabs (Top Bar)

- One tab per active thread
- Status indicators: ● (running), ✓ (completed), ⚠ (error)
- Close button to remove thread from view
- "+" button to start new agent run (opens modal/input)

## Data Flow

### Starting a New Agent Run

1. User clicks "+" in ThreadTabs or enters input
2. Frontend calls `POST /run` with user input
3. Backend returns `threadId` and `status: "started"`
4. Frontend creates new ThreadState
5. Frontend opens SSE connection to `/stream?threadId=xxx`
6. Backend begins streaming events
7. Frontend updates UI in real-time

### SSE Event Processing

```typescript
// useBullhorseStream hook
1. Open EventSource connection to /stream?threadId=xxx
2. Listen for message events
3. Parse JSON payload
4. Determine event type
5. Update Zustand store
6. React re-renders affected components

// Special handling for todos
- Todo events update both todos array AND timeline
- TodoSidebar reads from todos array
- Timeline shows todo events for chronology

// Special handling for LLM chunks
- Debounce rapid chunks (combine within 100ms)
- Accumulate content for display
- Show typing indicator during gaps
```

### Error Handling

**Connection Drop:**
1. EventSource auto-reconnects (browser behavior)
2. On reconnect, request history via `/trace/:threadId`
3. Merge historical events with current state
4. Show "Reconnected" toast notification

**Server Error:**
1. Error event received via SSE
2. Display error banner in UI
3. Mark thread status as 'error'
4. Show retry button

## API Contract

### SSE Stream

**Request:**
```http
GET /stream?threadId=abc123 HTTP/1.1
Accept: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Response:**
```
data: {"type":"session_start","threadId":"abc123","timestamp":1714680123456}

data: {"type":"todo_added","id":"1","subject":"Explore codebase","status":"pending"}

data: {"type":"llm_start","model":"gpt-4o","timestamp":1714680124000}

data: {"type":"llm_chunk","content":"I'll search","timestamp":1714680124100}

data: {"type":"llm_chunk","content":" for the","timestamp":1714680124150}

data: {"type":"tool_call","tool":"code_search","args":{"query":"auth"},"timestamp":1714680125000}

data: {"type":"tool_result","tool":"code_search","result":{"files":12},"duration":234,"timestamp":1714680125234}

data: {"type":"session_end","threadId":"abc123","timestamp":1714680200000}
```

### Start Agent Run

**Request:**
```http
POST /run HTTP/1.1
Content-Type: application/json

{
  "input": "Fix the auth bug",
  "threadId": "optional-custom-id"
}
```

**Response:**
```json
{
  "threadId": "abc123",
  "status": "started"
}
```

### Thread History (for reconnection)

**Request:**
```http
GET /trace/:threadId HTTP/1.1
```

**Response:**
```json
{
  "threadId": "abc123",
  "events": [...],
  "todos": [...]
}
```

## Configuration

### Environment Variables (Bullhorse)

```bash
# Enable SSE streaming endpoint
STREAM_ENABLED=true

# CORS for UI origin
UI_ORIGIN=http://localhost:3001
```

### Environment Variables (Next.js UI)

```bash
# Bullhorse API URL
NEXT_PUBLIC_BULLHORSE_API_URL=http://localhost:7860

# API secret (if Bullhorse requires auth)
BULLHORSE_API_SECRET=your-secret
```

## Implementation Phases

### Phase 1: Backend SSE Implementation
1. Create `src/stream.ts` with SSE utilities
2. Modify `src/harness/deepagents.ts` to emit events
3. Add `/stream` endpoint to `src/webapp.ts`
4. Test SSE output with curl

### Phase 2: Frontend Skeleton
1. Create Next.js project with AI Elements
2. Set up Zustand store
3. Create basic layout (ThreadMonitor, TodoSidebar, ThreadTabs)
4. Implement `useBullhorseStream` hook

### Phase 3: Event Rendering
1. Build event adapter for AI Elements
2. Implement LLM event display
3. Implement tool call display
4. Add error handling UI

### Phase 4: Todo Integration
1. Parse todo events from stream
2. Update TodoSidebar in real-time
3. Sync todos with timeline
4. Add todo status indicators

### Phase 5: Polish
1. Add reconnection logic
2. Implement thread history merge
3. Add loading states
4. Style refinements

## Success Criteria

- [ ] User can start agent run and see real-time updates
- [ ] LLM thinking is visible as chunks arrive
- [ ] Tool calls display with args and results
- [ ] Todos are always visible and update live
- [ ] Multiple threads can run concurrently with tabs
- [ ] Connection drops auto-recover with history merge
- [ ] Errors display clearly with retry option
