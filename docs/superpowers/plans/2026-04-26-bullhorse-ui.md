# Bullhorse Agent UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time UI for monitoring Bullhorse agent execution with LLM thinking, tool calls, and todos visualized in a timeline with concurrent thread support.

**Architecture:** SSE-based streaming from Bullhorse backend → Next.js frontend with AI Components + Zustand state management → Real-time UI updates.

**Tech Stack:** Bullhorse (Hono, LangChain), Next.js 14+, AI Components, shadcn/ui, TypeScript, Tailwind CSS, Zustand

---

## File Structure

### Backend (Bullhorse - existing repo)
```
src/
├── stream.ts                    # NEW - SSE event emitter utilities
├── harness/
│   └── deepagents.ts            # MODIFY - emit structured events during execution
└── webapp.ts                    # MODIFY - add /stream endpoint
```

### Frontend (bullhorse-ui - new standalone repo)
```
bullhorse-ui/
├── package.json                 # NEW - dependencies
├── tsconfig.json                # NEW - TypeScript config
├── next.config.js               # NEW - Next.js config
├── tailwind.config.ts           # NEW - Tailwind config
├── app/
│   ├── layout.tsx               # NEW - root layout with providers
│   ├── page.tsx                 # NEW - main monitor page
│   └── api/
│       └── proxy/
│           └── route.ts         # NEW - API proxy for CORS
├── components/
│   ├── ThreadMonitor.tsx        # NEW - main timeline container
│   ├── TodoSidebar.tsx          # NEW - always-visible todo panel
│   └── ThreadTabs.tsx           # NEW - tab management
├── lib/
│   ├── types.ts                 # NEW - shared TypeScript types
│   ├── bullhorse-client.ts      # NEW - SSE connection manager
│   └── event-adapter.ts         # NEW - SSE events → AI Components format
├── hooks/
│   └── useBullhorseStream.ts    # NEW - custom SSE hook
└── store/
    └── thread-store.ts          # NEW - Zustand state management
```

---

## Phase 1: Backend SSE Implementation

### Task 1: Create SSE Event Types and Utilities

**Files:**
- Create: `src/stream.ts`

- [ ] **Step 1: Write SSE event type definitions**

```typescript
// src/stream.ts

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
```

- [ ] **Step 2: Add SSE emitter class**

```typescript
// Add to src/stream.ts

import { createLogger } from "./utils/logger";

const logger = createLogger("stream");

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
```

- [ ] **Step 3: Add stream registry for managing multiple connections**

```typescript
// Add to src/stream.ts

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
```

- [ ] **Step 4: Commit**

```bash
git add src/stream.ts
git commit -m "feat: add SSE event types and emitter utilities

- Define all SSE event types (session, LLM, tools, todos, errors)
- Implement SSEEmitter class for streaming events
- Add StreamRegistry for managing multiple connections
- Auto-cleanup old streams every 30 minutes"
```

### Task 2: Add /stream Endpoint to Webapp

**Files:**
- Modify: `src/webapp.ts`

- [ ] **Step 1: Import stream utilities**

```typescript
// Add to imports at top of src/webapp.ts

import { streamRegistry, type SSEEvent } from "./stream";
```

- [ ] **Step 2: Add /stream endpoint before the default export**

```typescript
// Add to src/webapp.ts after the /metrics endpoint (around line 735)

/**
 * SSE stream endpoint for real-time agent execution events
 * GET /stream?threadId=:threadId
 */
app.get("/stream", async (c) => {
  const threadId = c.req.query("threadId") || "default-session";

  // Verify authentication if enabled
  const secret = process.env.API_SECRET_KEY;
  if (secret) {
    const authHeader = c.req.header("Authorization");
    const token = authHeader
      ? authHeader.replace(/^Bearer\s+/i, "")
      : c.req.query("token");

    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const tokenBuffer = Buffer.from(token);
    const secretBuffer = Buffer.from(secret);

    if (
      tokenBuffer.length !== secretBuffer.length ||
      !timingSafeEqual(tokenBuffer, secretBuffer)
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }

  // Create SSE stream
  const stream = streamRegistry.createStream(threadId);

  // Set SSE headers
  return c.body(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/webapp.ts
git commit -m "feat: add /stream SSE endpoint

- Add GET /stream endpoint for real-time events
- Support threadId query parameter
- Include authentication check
- Set proper SSE headers"
```

### Task 3: Emit Events from DeepAgents Harness

**Files:**
- Modify: `src/harness/deepagents.ts`

- [ ] **Step 1: Import stream utilities**

```typescript
// Add to imports at top of src/harness/deepagents.ts

import { streamRegistry, type SSEEvent } from "../stream";
```

- [ ] **Step 2: Add helper function to emit events**

```typescript
// Add to src/harness/deepagents.ts after the imports (around line 68)

/**
 * Emit an event to the SSE stream for a thread
 */
function emitStreamEvent(threadId: string, event: SSEEvent): void {
  const emitter = streamRegistry.getEmitter(threadId);
  if (emitter) {
    emitter.emit(event);
  }
}
```

- [ ] **Step 3: Emit session_start at the beginning of invoke()**

```typescript
// Find the invoke() method in DeepAgentWrapper class (around line 827)
// Add this after the threadId declaration (around line 833):

// Emit session start
emitStreamEvent(threadId, {
  type: "session_start",
  threadId,
  timestamp: Date.now(),
});
```

- [ ] **Step 4: Wrap agent invocation to capture LLM events**

```typescript
// Find the agent.invoke() call (around line 1020)
// Replace the simple invoke with event-emitting wrapper:

// Before calling agent.invoke, emit LLM start
const model = modelConfig.model || "unknown";
emitStreamEvent(threadId, {
  type: "llm_start",
  model,
  timestamp: Date.now(),
});

// Store original messages length for token counting
const messagesBeforeLength = messages.length;

// The agent.invoke() call remains here (existing code)
result = traceTerminal
  ? await runDeepAgentWithStreamTrace(
      agent,
      modifiedInput,
      configurable,
    )
  : await agent.invoke(
      { messages: [{ role: "user", content: modifiedInput }] },
      {
        configurable,
        recursionLimit: AGENT_RECURSION_LIMIT,
      },
    );

// Calculate tokens (rough estimate)
const messagesAfter = result.messages || [];
const totalTokens = JSON.stringify(messagesAfter).length / 4; // Rough estimate

// Emit LLM end
emitStreamEvent(threadId, {
  type: "llm_end",
  totalTokens: Math.round(totalTokens),
  timestamp: Date.now(),
});
```

- [ ] **Step 5: Capture and emit tool call events**

```typescript
// Find the section where messages are logged (around line 1052)
// Add tool call event emission after the debug logging:

// After the messages.forEach loop (around line 1118), add:

// Emit tool call events
for (const msg of messages) {
  if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      emitStreamEvent(threadId, {
        type: "tool_call",
        tool: tc.name || "unknown",
        args: tc.args || {},
        timestamp: Date.now(),
      });
    }
  }

  // Emit tool result events
  if ((msg.type === "tool" || msg.role === "tool") && msg.name) {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
    emitStreamEvent(threadId, {
      type: "tool_result",
      tool: String(msg.name),
      result: content,
      duration: 0, // We don't have individual tool timing
      timestamp: Date.now(),
    });
  }
}
```

- [ ] **Step 6: Emit session_end before returning**

```typescript
// Find the return statement at the end of invoke() (around line 1235)
// Add this right before the return:

// Emit session end
emitStreamEvent(threadId, {
  type: "session_end",
  threadId,
  timestamp: Date.now(),
});

// Then the existing return statement:
return {
  reply: responseText,
  messages,
};
```

- [ ] **Step 7: Emit error events**

```typescript
// Find the error handling in invoke() (around line 1028 and 1240)
// Add error event emission:

// In the catch block after agent.invoke() fails (around line 1028):
emitStreamEvent(threadId, {
  type: "error",
  message: errorMsg,
  timestamp: Date.now(),
});

// In the catch block at the end of invoke() (around line 1240):
emitStreamEvent(threadId, {
  type: "error",
  message: errorMsg,
  timestamp: Date.now(),
});
```

- [ ] **Step 8: Add todo event emission (middleware integration)**

```typescript
// Note: Bullhorse uses todoListMiddleware which doesn't currently emit events
// For now, we'll add a simple hook that can be enhanced later

// Add this helper after the emitStreamEvent function (around line 73):

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
```

- [ ] **Step 9: Commit**

```bash
git add src/harness/deepagents.ts
git commit -m "feat: emit SSE events during agent execution

- Emit session_start/session_end for lifecycle
- Emit llm_start/llm_end around model calls
- Emit tool_call/tool_result for each tool invocation
- Emit error events on failures
- Add emitTodoEvent helper for todo middleware"
```

### Task 4: Test SSE Endpoint

**Files:**
- Create: `tests/stream.test.ts`

- [ ] **Step 1: Write integration test for SSE endpoint**

```typescript
// tests/stream.test.ts

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { streamRegistry } from "../src/stream";

const BULLHORSE_PORT = parseInt(process.env.BULLHORSE_TEST_PORT || "7861");
const BULLHORSE_URL = `http://localhost:${BULLHORSE_PORT}`;

describe("SSE Endpoint", () => {
  let server: any;

  beforeAll(async () => {
    // Start test server
    const { default: app } = await import("../src/webapp");
    server = Bun.serve({
      port: BULLHORSE_PORT,
      fetch: app.fetch,
    });
  });

  afterAll(() => {
    server?.stop();
  });

  it("should accept SSE connections", async () => {
    const response = await fetch(
      `${BULLHORSE_URL}/stream?threadId=test-thread`,
      {
        headers: {
          Accept: "text/event-stream",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });

  it("should require authentication when enabled", async () => {
    // This test only runs if API_SECRET_KEY is set
    if (!process.env.API_SECRET_KEY) {
      return; // Skip test
    }

    const response = await fetch(
      `${BULLHORSE_URL}/stream?threadId=test-thread`,
    );

    expect(response.status).toBe(401);
  });

  it("should emit events to the stream", async () => {
    const threadId = "test-emission";

    // Start stream connection in background
    const streamPromise = fetch(
      `${BULLHORSE_URL}/stream?threadId=${threadId}`,
      {
        headers: {
          Accept: "text/event-stream",
        },
      },
    );

    // Wait a bit for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get emitter and emit event
    const emitter = streamRegistry.getEmitter(threadId);
    expect(emitter).toBeDefined();

    emitter?.emit({
      type: "test_event",
      timestamp: Date.now(),
    } as any);

    // Close emitter
    emitter?.end();

    // Get response
    const response = await streamPromise;
    const text = await response.text();

    expect(text).toContain("data:");
  });
});
```

- [ ] **Step 2: Run tests to verify**

```bash
bun test tests/stream.test.ts
```

Expected: Tests pass

- [ ] **Step 3: Manual test with curl**

```bash
# Terminal 1: Start server
bun run dev

# Terminal 2: Connect to SSE stream
curl -N http://localhost:7860/stream?threadId=test-123

# In another terminal, trigger an agent run
curl -X POST http://localhost:7860/run \
  -H "Content-Type: application/json" \
  -d '{"input": "say hello", "threadId": "test-123"}'
```

Expected: See SSE events in curl output

- [ ] **Step 4: Commit**

```bash
git add tests/stream.test.ts
git add docs/superpowers/specs/2026-04-26-bullhorse-ui-design.md
git commit -m "test: add SSE endpoint integration tests

- Test SSE connection acceptance
- Test authentication requirement
- Test event emission
- Add manual testing instructions"
```

---

## Phase 2: Frontend Project Setup

### Task 5: Initialize Next.js Project

**Files:**
- Create: `bullhorse-ui/package.json`
- Create: `bullhorse-ui/tsconfig.json`
- Create: `bullhorse-ui/next.config.js`
- Create: `bullhorse-ui/tailwind.config.ts`
- Create: `bullhorse-ui/postcss.config.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "bullhorse-ui",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@ai-sdk/react": "^1.0.0",
    "ai-elements": "latest",
    "zustand": "^4.5.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "^14.2.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create next.config.js**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/proxy/:path*",
        destination: `${process.env.NEXT_PUBLIC_BULLHORSE_API_URL || "http://localhost:7860"}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
```

- [ ] **Step 4: Create tailwind.config.ts**

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

- [ ] **Step 5: Create postcss.config.js**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create .env.local**

```bash
# Bullhorse API URL
NEXT_PUBLIC_BULLHORSE_API_URL=http://localhost:7860

# API secret (if Bullhorse requires auth)
# BULLHORSE_API_SECRET=your-secret
```

- [ ] **Step 7: Create .gitignore**

```
# dependencies
/node_modules
/.pnp
.pnp.js

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# local env files
.env*.local

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 8: Initialize git and commit**

```bash
cd bullhorse-ui
git init
git add .
git commit -m "chore: initialize Next.js project

- Set up Next.js 14 with App Router
- Configure TypeScript and Tailwind CSS
- Add AI Elements and Zustand dependencies
- Configure environment variables
"
```

### Task 6: Install AI Elements and shadcn/ui

**Files:**
- Create: `bullhorse-ui/components.json`
- Create: `bullhorse-ui/app/globals.css`

- [ ] **Step 1: Install dependencies**

```bash
cd bullhorse-ui
bun install
bun add -D tailwindcss-animate
```

- [ ] **Step 2: Create components.json for shadcn/ui**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 3: Create lib/utils.ts**

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Create app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 5: Install AI Elements**

```bash
npx ai-elements add conversation
npx ai-elements add message
npx ai-elements add message-content
```

- [ ] **Step 6: Install base shadcn components**

```bash
npx shadcn-ui@latest add button
npx shadcn-ui@latest add tabs
npx shadcn-ui@latest add scroll-area
npx shadcn-ui@latest add checkbox
npx shadcn-ui@latest add card
npx shadcn-ui@latest add badge
npx shadcn-ui@latest add input
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: install AI Elements and shadcn/ui

- Install AI Components for conversation UI
- Configure shadcn/ui with base components
- Set up Tailwind CSS with custom theme
- Add utility functions for className merging"
```

---

## Phase 3: Frontend Core Implementation

### Task 7: Create Type Definitions

**Files:**
- Create: `bullhorse-ui/lib/types.ts`

- [ ] **Step 1: Create shared type definitions**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add TypeScript type definitions

- Define all SSE event types matching backend
- Add ThreadState and AppState interfaces
- Export Todo and ThreadStatus types"
```

### Task 8: Create Zustand Store

**Files:**
- Create: `bullhorse-ui/store/thread-store.ts`

- [ ] **Step 1: Create Zustand store**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add store/thread-store.ts
git commit -m "feat: add Zustand store for thread state

- Manage multiple thread states
- Track active thread
- Actions: add/remove/update threads, add events, update todos
- Auto-update thread status on session_end"
```

### Task 9: Create SSE Connection Hook

**Files:**
- Create: `bullhorse-ui/lib/bullhorse-client.ts`
- Create: `bullhorse-ui/hooks/useBullhorseStream.ts`

- [ ] **Step 1: Create SSE client**

```typescript
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
    for (const threadId of this.eventSources.keys()) {
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
```

- [ ] **Step 2: Create React hook**

```typescript
// hooks/useBullhorseStream.ts

"use client";

import { useEffect, useRef, useCallback } from "react";
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
  const { addThread, addEvent, updateTodo, updateThread } = useThreadStore();

  const handleEvent = useCallback((event: SSEEvent) => {
    // Add event to thread
    addEvent(threadId, event);

    // Handle todo events separately
    if (event.type === "todo_added" || event.type === "todo_updated") {
      const todo: Todo = {
        id: event.id,
        subject: event.subject,
        status: event.status,
      };
      updateTodo(threadId, todo);
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
        updateThread(threadId, { status: "running", error: undefined });
      },
      onError: () => {
        updateThread(threadId, { status: "error" });
      },
    });

    // Cleanup on unmount
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [threadId, enabled, handleEvent, addThread, updateThread]);

  return {
    isConnected: unsubscribeRef.current !== null,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/bullhorse-client.ts hooks/useBullhorseStream.ts
git commit -m "feat: add SSE client and React hook

- Implement BullhorseClient for SSE connections
- Add useBullhorseStream hook for React components
- Handle all SSE event types
- Auto-manage thread state in Zustand store"
```

### Task 10: Create Event Adapter for AI Elements

**Files:**
- Create: `bullhorse-ui/lib/event-adapter.ts`

- [ ] **Step 1: Create event adapter**

```typescript
// lib/event-adapter.ts

import type { SSEEvent } from "./types";

export interface AdaptedMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp?: number;
  metadata?: {
    tool?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    duration?: number;
    model?: string;
    tokens?: number;
  };
}

export function adaptEventToMessage(event: SSEEvent): AdaptedMessage | null {
  const baseMessage = {
    id: `${event.type}-${event.timestamp}`,
    timestamp: event.timestamp,
  };

  switch (event.type) {
    case "llm_start":
      return {
        ...baseMessage,
        role: "assistant",
        content: `🧠 Thinking with ${event.model}...`,
        metadata: {
          model: event.model,
        },
      };

    case "llm_chunk":
      return {
        ...baseMessage,
        role: "assistant",
        content: event.content,
      };

    case "llm_end":
      return {
        ...baseMessage,
        role: "assistant",
        content: `✅ Completed (${event.totalTokens} tokens)`,
        metadata: {
          tokens: event.totalTokens,
        },
      };

    case "tool_call":
      return {
        ...baseMessage,
        role: "tool",
        content: `🔧 Calling ${event.tool}`,
        metadata: {
          tool: event.tool,
          args: event.args,
        },
      };

    case "tool_result":
      const resultPreview =
        typeof event.result === "string"
          ? event.result.slice(0, 200) + (event.result.length > 200 ? "..." : "")
          : JSON.stringify(event.result).slice(0, 200) + "...";

      return {
        ...baseMessage,
        role: "tool",
        content: `✓ ${event.tool} → ${resultPreview}`,
        metadata: {
          tool: event.tool,
          result: event.result,
          duration: event.duration,
        },
      };

    case "todo_added":
    case "todo_updated":
      return {
        ...baseMessage,
        role: "system",
        content: `📋 ${event.type === "todo_added" ? "Added" : "Updated"} todo: ${event.subject}`,
      };

    case "todo_completed":
      return {
        ...baseMessage,
        role: "system",
        content: `✓ Completed todo: ${event.id}`,
      };

    case "error":
      return {
        ...baseMessage,
        role: "system",
        content: `❌ Error: ${event.message}`,
      };

    case "session_start":
    case "session_end":
      return null; // Don't show lifecycle events in timeline

    default:
      return null;
  }
}

export function adaptEventsToMessages(events: SSEEvent[]): AdaptedMessage[] {
  return events
    .map((event) => adaptEventToMessage(event))
    .filter((msg): msg is AdaptedMessage => msg !== null);
}

// Group LLM chunks to reduce message count
export function groupLLMChunks(messages: AdaptedMessage[]): AdaptedMessage[] {
  const grouped: AdaptedMessage[] = [];
  let currentChunk: AdaptedMessage | null = null;

  for (const message of messages) {
    if (message.role === "assistant" && !message.metadata?.tool) {
      if (!currentChunk) {
        currentChunk = message;
      } else {
        currentChunk.content += message.content;
        currentChunk.timestamp = message.timestamp;
      }
    } else {
      if (currentChunk) {
        grouped.push(currentChunk);
        currentChunk = null;
      }
      grouped.push(message);
    }
  }

  if (currentChunk) {
    grouped.push(currentChunk);
  }

  return grouped;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/event-adapter.ts
git commit -m "feat: add event adapter for AI Elements

- Convert SSE events to AI Components message format
- Group LLM chunks to reduce message count
- Filter out lifecycle events from timeline
- Add metadata for tool calls and results"
```

---

## Phase 4: UI Components

### Task 11: Create Todo Sidebar

**Files:**
- Create: `bullhorse-ui/components/TodoSidebar.tsx`

- [ ] **Step 1: Create TodoSidebar component**

```typescript
// components/TodoSidebar.tsx

"use client";

import { useThreadStore } from "@/store/thread-store";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TodoSidebarProps {
  threadId: string;
  className?: string;
}

export function TodoSidebar({ threadId, className }: TodoSidebarProps) {
  const thread = useThreadStore((state) => state.threads[threadId]);

  if (!thread) {
    return (
      <Card className={cn("p-4", className)}>
        <p className="text-sm text-muted-foreground">No thread selected</p>
      </Card>
    );
  }

  const { todos } = thread;

  const getStatusIcon = (status: Todo["status"]) => {
    switch (status) {
      case "pending":
        return <Circle className="h-4 w-4 text-muted-foreground" />;
      case "in_progress":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
  };

  const getStatusBadgeVariant = (status: Todo["status"]): "default" | "secondary" | "outline" => {
    switch (status) {
      case "pending":
        return "secondary";
      case "in_progress":
        return "default";
      case "completed":
        return "outline";
    }
  };

  return (
    <Card className={cn("flex flex-col h-full", className)}>
      <div className="p-4 border-b">
        <h2 className="font-semibold text-sm">Tasks</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {todos.filter((t) => t.status === "completed").length} / {todos.length} completed
        </p>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {todos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet</p>
          ) : (
            todos.map((todo) => (
              <div
                key={todo.id}
                className={cn(
                  "flex items-start gap-3 p-2 rounded-lg transition-colors",
                  todo.status === "in_progress" && "bg-blue-50 dark:bg-blue-950/20",
                )}
              >
                <Checkbox
                  checked={todo.status === "completed"}
                  disabled
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(todo.status)}
                    <p
                      className={cn(
                        "text-sm font-medium",
                        todo.status === "completed" && "line-through text-muted-foreground",
                      )}
                    >
                      {todo.subject}
                    </p>
                  </div>
                  {todo.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {todo.description}
                    </p>
                  )}
                </div>
                <Badge variant={getStatusBadgeVariant(todo.status)} className="text-xs">
                  {todo.status}
                </Badge>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/TodoSidebar.tsx
git commit -m "feat: add TodoSidebar component

- Display todos for active thread
- Show status icons (pending/in-progress/completed)
- Highlight active in-progress todo
- Show completion progress"
```

### Task 12: Create Thread Tabs

**Files:**
- Create: `bullhorse-ui/components/ThreadTabs.tsx`

- [ ] **Step 1: Create ThreadTabs component**

```typescript
// components/ThreadTabs.tsx

"use client";

import { useThreadStore } from "@/store/thread-store";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Circle, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getBullhorseClient } from "@/lib/bullhorse-client";

export function ThreadTabs() {
  const { threads, activeThreadId, setActiveThread, removeThread, addThread } =
    useThreadStore();
  const [newRunInput, setNewRunInput] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const threadIds = Object.keys(threads);

  const getStatusIcon = (threadId: string) => {
    const thread = threads[threadId];
    switch (thread.status) {
      case "running":
        return <Circle className="h-3 w-3 text-blue-500 animate-pulse" />;
      case "completed":
        return <CheckCircle2 className="h-3 w-3 text-green-500" />;
      case "error":
        return <AlertCircle className="h-3 w-3 text-red-500" />;
      default:
        return <Circle className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const handleStartRun = async () => {
    if (!newRunInput.trim()) return;

    setIsStarting(true);
    try {
      const client = getBullhorseClient();
      const result = await client.startRun(newRunInput.trim());

      addThread(result.threadId);
      setActiveThread(result.threadId);
      setNewRunInput("");
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Failed to start run:", error);
    } finally {
      setIsStarting(false);
    }
  };

  const handleRemoveThread = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeThread(threadId);

    // Switch to another thread if we removed the active one
    if (activeThreadId === threadId) {
      const remainingIds = Object.keys(threads).filter((id) => id !== threadId);
      setActiveThread(remainingIds[0] || null);
    }
  };

  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      {threadIds.length > 0 ? (
        <Tabs value={activeThreadId || ""} onValueChange={setActiveThread}>
          <TabsList className="bg-transparent border-none h-auto p-0 gap-2">
            {threadIds.map((threadId) => (
              <TabsTrigger
                key={threadId}
                value={threadId}
                className={cn(
                  "relative data-[state=active]:bg-muted data-[state=active]:border data-[state=active]:border-border",
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm",
                )}
              >
                {getStatusIcon(threadId)}
                <span className="max-w-[150px] truncate">
                  Thread-{threadId.slice(0, 8)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 ml-1 hover:bg-destructive hover:text-destructive-foreground"
                  onClick={(e) => handleRemoveThread(threadId, e)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">No active threads</p>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="ml-auto gap-1">
            <Plus className="h-4 w-4" />
            New Run
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start New Agent Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="What should the agent do?"
              value={newRunInput}
              onChange={(e) => setNewRunInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleStartRun();
                }
              }}
              disabled={isStarting}
            />
            <Button
              onClick={handleStartRun}
              disabled={!newRunInput.trim() || isStarting}
              className="w-full"
            >
              {isStarting ? "Starting..." : "Start Run"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Add dialog components from shadcn**

```bash
npx shadcn-ui@latest add dialog
```

- [ ] **Step 3: Commit**

```bash
git add components/ThreadTabs.tsx
git commit -m "feat: add ThreadTabs component

- Display tabs for each active thread
- Show status indicators (running/completed/error)
- Add new run dialog
- Handle thread removal with auto-switch"
```

### Task 13: Create Thread Monitor

**Files:**
- Create: `bullhorse-ui/components/ThreadMonitor.tsx`

- [ ] **Step 1: Create ThreadMonitor component**

```typescript
// components/ThreadMonitor.tsx

"use client";

import { useThreadStore } from "@/store/thread-store";
import { TodoSidebar } from "@/components/TodoSidebar";
import { useBullhorseStream } from "@/hooks/useBullhorseStream";
import { adaptEventsToMessages, groupLLMChunks } from "@/lib/event-adapter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import type { Message } from "ai";

interface ThreadMonitorProps {
  threadId: string;
}

export function ThreadMonitor({ threadId }: ThreadMonitorProps) {
  const thread = useThreadStore((state) => state.threads[threadId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isConnected } = useBullhorseStream({ threadId, enabled: !!thread });

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread?.events.length]);

  if (!thread) {
    return (
      <Card className="p-8 flex items-center justify-center">
        <p className="text-muted-foreground">Select or create a thread to begin</p>
      </Card>
    );
  }

  const messages = groupLLMChunks(adaptEventsToMessages(thread.events));

  // Convert to AI Components message format
  const aiMessages: Message[] = messages.map((msg, idx) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant" | "system" | "tool",
    content: msg.content,
    createdAt: new Date(msg.timestamp || Date.now()),
  }));

  return (
    <div className="flex h-full gap-4">
      {/* Todo Sidebar */}
      <TodoSidebar threadId={threadId} className="w-80" />

      {/* Main Timeline */}
      <Card className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Timeline</h2>
            {thread.status === "running" && (
              <Badge variant="default" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Running
              </Badge>
            )}
            {thread.status === "completed" && (
              <Badge variant="outline">Completed</Badge>
            )}
            {thread.status === "error" && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="h-3 w-3" />
                Error
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {messages.length} events
          </p>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Waiting for events...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "p-3 rounded-lg border",
                    msg.role === "assistant" && "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
                    msg.role === "tool" && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
                    msg.role === "system" && "bg-muted",
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      {msg.role === "assistant" && "🧠 Thinking"}
                      {msg.role === "tool" && "🔧 Tool"}
                      {msg.role === "system" && "📋 System"}
                    </span>
                    {msg.metadata?.tool && (
                      <Badge variant="secondary" className="text-xs">
                        {msg.metadata.tool}
                      </Badge>
                    )}
                    {msg.metadata?.tokens && (
                      <span className="text-xs text-muted-foreground">
                        {msg.metadata.tokens} tokens
                      </span>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                  {msg.metadata?.args && (
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer">
                        Arguments
                      </summary>
                      <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-x-auto">
                        {JSON.stringify(msg.metadata.args, null, 2)}
                      </pre>
                    </details>
                  )}
                  {msg.metadata?.duration && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Duration: {msg.metadata.duration}ms
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add lucide-react icons**

```bash
bun add lucide-react
```

- [ ] **Step 3: Commit**

```bash
git add components/ThreadMonitor.tsx
git commit -m "feat: add ThreadMonitor component

- Display timeline of events with AI Elements
- Show messages grouped by type (thinking/tool/system)
- Auto-scroll to latest events
- Show metadata (args, duration, tokens)"
```

---

## Phase 5: App Integration

### Task 14: Create Main Page and Layout

**Files:**
- Create: `bullhorse-ui/app/layout.tsx`
- Create: `bullhorse-ui/app/page.tsx`

- [ ] **Step 1: Create root layout**

```typescript
// app/layout.tsx

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bullhorse Agent Monitor",
  description: "Real-time visualization of Bullhorse agent execution",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Create main page**

```typescript
// app/page.tsx

"use client";

import { ThreadTabs } from "@/components/ThreadTabs";
import { ThreadMonitor } from "@/components/ThreadMonitor";
import { useThreadStore } from "@/store/thread-store";
import { useEffect } from "react";

export default function Home() {
  const { activeThreadId } = useThreadStore();

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background">
        <div className="container mx-auto px-4 py-3">
          <h1 className="text-xl font-bold">Bullhorse Agent Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Real-time visualization of agent execution
          </p>
        </div>
      </header>

      {/* Thread Tabs */}
      <ThreadTabs />

      {/* Main Content */}
      <main className="flex-1 container mx-auto p-4 overflow-hidden">
        {activeThreadId ? (
          <ThreadMonitor threadId={activeThreadId} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-lg font-semibold mb-2">No active thread</h2>
              <p className="text-muted-foreground mb-4">
                Click "New Run" to start monitoring an agent execution
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx app/page.tsx
git commit -m "feat: create main page and layout

- Set up root layout with metadata
- Create main page with ThreadTabs and ThreadMonitor
- Handle empty state when no thread is active"
```

### Task 15: Add API Proxy Route

**Files:**
- Create: `bullhorse-ui/app/api/proxy/route.ts`

- [ ] **Step 1: Create API proxy**

```typescript
// app/api/proxy/route.ts

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { pathname } = new URL(request.url);
  const searchParams = request.nextUrl.searchParams;

  // Remove /api/proxy prefix
  const targetPath = pathname.replace("/api/proxy", "");
  const targetUrl = new URL(
    `${targetPath}?${searchParams.toString()}`,
    process.env.NEXT_PUBLIC_BULLHORSE_API_URL || "http://localhost:7860",
  );

  // Forward headers
  const headers = new Headers();
  const accept = request.headers.get("accept");
  if (accept) {
    headers.set("Accept", accept);
  }

  // Add auth if configured
  const apiSecret = process.env.BULLHORSE_API_SECRET;
  if (apiSecret) {
    headers.set("Authorization", `Bearer ${apiSecret}`);
  }

  // Forward the request
  const response = await fetch(targetUrl.toString(), {
    method: "GET",
    headers,
  });

  // Stream SSE responses
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Return JSON responses
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function POST(request: NextRequest) {
  const { pathname } = new URL(request.url);

  // Remove /api/proxy prefix
  const targetPath = pathname.replace("/api/proxy", "");
  const targetUrl = new URL(
    targetPath,
    process.env.NEXT_PUBLIC_BULLHORSE_API_URL || "http://localhost:7860",
  );

  // Get request body
  const body = await request.json();

  // Forward headers
  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  // Add auth if configured
  const apiSecret = process.env.BULLHORSE_API_SECRET;
  if (apiSecret) {
    headers.set("Authorization", `Bearer ${apiSecret}`);
  }

  // Forward the request
  const response = await fetch(targetUrl.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
```

- [ ] **Step 2: Update bullhorse-client to use proxy**

```typescript
// Update lib/bullhorse-client.ts

// Change the apiUrl in the constructor to use the proxy
constructor(options: BullhorseClientOptions = {}) {
  // Use relative URL to go through Next.js proxy
  this.apiUrl = options.apiUrl || "/api/proxy";
  this.apiSecret = options.apiSecret;
  this.eventSources = new Map();
}

// Also update subscribeToThread to use relative URL
subscribeToThread(
  threadId: string,
  callbacks: {
    onEvent: (event: SSEEvent) => void;
    onError?: (error: Event) => void;
    onOpen?: (event: Event) => void;
  },
): () => void {
  // ... existing code ...

  // Use relative URL for proxy
  const url = new URL("/api/proxy/stream", window.location.origin);
  url.searchParams.set("threadId", threadId);

  // Note: auth is handled by the proxy, so we don't need to add token here

  // ... rest of the method ...
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/proxy/route.ts lib/bullhorse-client.ts
git commit -m "feat: add API proxy route

- Create /api/proxy route for CORS handling
- Forward requests to Bullhorse backend
- Stream SSE responses properly
- Update client to use proxy URL"
```

---

## Phase 6: Polish and Testing

### Task 16: Add Error Handling and Reconnection

**Files:**
- Modify: `bullhorse-ui/hooks/useBullhorseStream.ts`

- [ ] **Step 1: Enhance error handling with reconnection**

```typescript
// Update hooks/useBullhorseStream.ts

// Add reconnection logic
import { useState } from "react";

export function useBullhorseStream({
  threadId,
  enabled = true,
}: UseBullhorseStreamOptions) {
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const { addThread, addEvent, updateTodo, updateThread } = useThreadStore();
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const maxReconnectAttempts = 5;

  const handleEvent = useCallback((event: SSEEvent) => {
    // Reset reconnect attempts on successful event
    setReconnectAttempts(0);

    // ... existing event handling ...
  }, [threadId, addEvent, updateTodo, updateThread]);

  const handleError = useCallback((error: Event) => {
    console.error(`[SSE] Error for thread ${threadId}:`, error);

    // Attempt reconnection
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      setTimeout(() => {
        setReconnectAttempts((prev) => prev + 1);
        // Force reconnection by toggling enabled
        // This will trigger the useEffect to re-run
      }, delay);
    } else {
      updateThread(threadId, {
        status: "error",
        error: "Connection failed after multiple reconnection attempts",
      });
    }
  }, [threadId, reconnectAttempts, updateThread]);

  useEffect(() => {
    if (!enabled) return;

    // ... existing connection code ...

    unsubscribeRef.current = client.subscribeToThread(threadId, {
      onEvent: handleEvent,
      onOpen: () => {
        setReconnectAttempts(0);
        updateThread(threadId, { status: "running", error: undefined });
      },
      onError: handleError,
    });

    // ... rest of the effect ...
  }, [threadId, enabled, handleEvent, handleError, addThread, updateThread, reconnectAttempts]);

  return {
    isConnected: unsubscribeRef.current !== null,
    reconnectAttempts,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useBullhorseStream.ts
git commit -m "feat: add SSE reconnection logic

- Exponential backoff for reconnection
- Max 5 reconnection attempts
- Reset attempts on successful event
- Show error after max attempts"
```

### Task 17: Add Loading States and Toast Notifications

**Files:**
- Modify: `bullhorse-ui/components/ThreadTabs.tsx`
- Create: `bullhorse-ui/components/ui/toast.tsx`
- Create: `bullhorse-ui/components/ui/use-toast.ts`

- [ ] **Step 1: Add toast components from shadcn**

```bash
npx shadcn-ui@latest add toast
npx shadcn-ui@latest add sonner
```

- [ ] **Step 2: Add toast notifications to ThreadTabs**

```typescript
// Update components/ThreadTabs.tsx

import { toast } from "sonner";
import { getBullhorseClient } from "@/lib/bullhorse-client";

// Update handleStartRun function
const handleStartRun = async () => {
  if (!newRunInput.trim()) return;

  setIsStarting(true);
  try {
    const client = getBullhorseClient();
    const result = await client.startRun(newRunInput.trim());

    addThread(result.threadId);
    setActiveThread(result.threadId);
    setNewRunInput("");
    setIsDialogOpen(false);

    toast.success("Agent run started", {
      description: "The agent is now processing your request",
    });
  } catch (error) {
    console.error("Failed to start run:", error);
    toast.error("Failed to start agent run", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    setIsStarting(false);
  }
};
```

- [ ] **Step 3: Add Toaster to layout**

```typescript
// Update app/layout.tsx

import { Toaster } from "@/components/ui/sonner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/ThreadTabs.tsx app/layout.tsx
git commit -m "feat: add toast notifications

- Show success/error toasts for agent runs
- Add Toaster component to layout
- Improve user feedback"
```

### Task 18: Final Testing and Documentation

**Files:**
- Create: `bullhorse-ui/README.md`
- Create: `bullhorse-ui/DEVELOPMENT.md`

- [ ] **Step 1: Create README**

```markdown
# Bullhorse Agent Monitor

Real-time UI for visualizing Bullhorse agent execution.

## Features

- 🧠 See LLM thinking in real-time
- 🔧 Watch tool calls and results
- 📋 Always-visible todo panel
- 🔄 Monitor concurrent agent runs
- 📊 Timeline view with metadata

## Getting Started

### Prerequisites

- Node.js 18+
- Bullhorse backend running on `http://localhost:7860`

### Installation

```bash
bun install
```

### Configuration

Create `.env.local`:

```bash
NEXT_PUBLIC_BULLHORSE_API_URL=http://localhost:7860
```

### Development

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production

```bash
bun run build
bun run start
```

## Usage

1. Click "New Run" to start an agent
2. Enter your request
3. Watch the timeline update in real-time
4. Monitor todos in the sidebar
5. Switch between threads using tabs

## Architecture

- Next.js 14 with App Router
- AI Components for conversation UI
- Zustand for state management
- SSE for real-time updates
```

- [ ] **Step 2: Create DEVELOPMENT guide**

```markdown
# Development Guide

## Project Structure

```
app/              # Next.js app directory
components/       # React components
lib/              # Utilities and clients
hooks/            # Custom React hooks
store/            # Zustand state management
```

## Key Components

- `ThreadMonitor` - Main timeline view
- `TodoSidebar` - Always-visible todo panel
- `ThreadTabs` - Thread management

## State Management

Uses Zustand with the following structure:

```typescript
{
  threads: Record<string, ThreadState>,
  activeThreadId: string | null
}
```

## SSE Protocol

The backend sends events over SSE:

```typescript
{ type: "llm_start", model: string, timestamp: number }
{ type: "llm_chunk", content: string, timestamp: number }
{ type: "tool_call", tool: string, args: object, timestamp: number }
// ... etc
```

## Adding New Event Types

1. Add type to `lib/types.ts`
2. Add handler in `lib/event-adapter.ts`
3. Update UI in `ThreadMonitor.tsx`
```

- [ ] **Step 3: Manual testing checklist**

```bash
# Terminal 1: Start Bullhorse backend
cd /path/to/bullhorse
bun run dev

# Terminal 2: Start UI
cd bullhorse-ui
bun run dev

# Terminal 3: Test with curl
curl -X POST http://localhost:7860/run \
  -H "Content-Type: application/json" \
  -d '{"input": "say hello", "threadId": "test-123"}'

# Verify SSE connection
curl -N http://localhost:7860/stream?threadId=test-123
```

**Manual testing checklist:**
- [ ] UI loads without errors
- [ ] Can start new agent run
- [ ] See events appear in timeline
- [ ] LLM chunks are grouped
- [ ] Tool calls show args/results
- [ ] Todos appear in sidebar
- [ ] Multiple threads work
- [ ] Error handling works
- [ ] Reconnection works

- [ ] **Step 4: Final commit**

```bash
git add README.md DEVELOPMENT.md
git commit -m "docs: add README and development guide

- Document features and usage
- Add architecture overview
- Include development setup
- Add manual testing checklist"
```

---

## Success Criteria Checklist

- [ ] User can start agent run and see real-time updates
- [ ] LLM thinking is visible as chunks arrive
- [ ] Tool calls display with args and results
- [ ] Todos are always visible and update live
- [ ] Multiple threads can run concurrently with tabs
- [ ] Connection drops auto-recover with exponential backoff
- [ ] Errors display clearly with retry option

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-bullhorse-ui.md`.**
