# Fix Compaction Middleware Trigger and Error Logging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix compaction middleware to only run once per turn (not multiple times per turn) and improve error logging.

**Architecture:** The compaction middleware's `wrapModelCall` is invoked on every model invocation within a turn, not just at turn boundaries. We need to detect new turns by checking for user messages instead of just comparing message counts.

**Tech Stack:** TypeScript, LangChain middleware, pino logger

---

## File Structure

**Files to modify:**
- `src/middleware/compact-middleware/index.ts` - Main middleware file with trigger logic
- `src/middleware/compact-middleware/index.test.ts` - Add tests for new behavior

---

### Task 1: Add turn detection by checking for user messages

**Files:**
- Modify: `src/middleware/compact-middleware/index.ts:183-270`
- Test: `src/middleware/compact-middleware/index.test.ts`

**Problem:** The current implementation checks `currentMessageCount > state.lastMessageCount` which triggers on every model call within a turn (as messages are added). We need to detect when a NEW turn starts (user message added).

**Solution:** Check if the last message is from a user, which indicates a new turn has started.

- [ ] **Step 1: Write a failing test for the new behavior**

Create a test file `src/middleware/compact-middleware/turn-detection.test.ts`:

```typescript
import { createCompactionMiddleware } from "./index";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("Turn Detection", () => {
  it("should only run compaction once per turn, not on every model call", async () => {
    const model = await ChatOpenAI.initialize({
      model: "gpt-4o",
      apiKey: "test",
    });

    const middleware = createCompactionMiddleware({ model });

    let compactionCount = 0;
    const originalLog = console.error;
    console.error = (...args: any[]) => {
      if (args[0]?.includes?.("Running compaction cascade")) {
        compactionCount++;
      }
      originalLog(...args);
    };

    try {
      const handler = vi.fn().mockResolvedValue({ content: "response" });

      // First model call in turn 1
      await middleware.wrapModelCall!(
        {
          messages: [new HumanMessage("turn 1")],
          configurable: { thread_id: "test-thread" },
        },
        handler,
      );

      // Second model call in same turn (after tool results added)
      await middleware.wrapModelCall!(
        {
          messages: [
            new HumanMessage("turn 1"),
            new AIMessage(""),
            { type: "tool", content: "result" },
          ],
          configurable: { thread_id: "test-thread" },
        },
        handler,
      );

      // Should have only run once, not twice
      expect(compactionCount).toBe(1);
    } finally {
      console.error = originalLog;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/middleware/compact-middleware/turn-detection.test.ts`

Expected: FAIL (compaction runs multiple times per turn)

- [ ] **Step 3: Add helper function to detect if last message is from user**

Add this function in `src/middleware/compact-middleware/index.ts` after the `extractModelName` function:

```typescript
/**
 * Check if the last message is from a user (indicating a new turn).
 */
function isNewTurn(messages: BaseMessage[]): boolean {
  if (messages.length === 0) return false;

  const lastMessage = messages[messages.length - 1];
  const type = lastMessage.getType();

  // Check if it's a human/user message
  return type === "human" || type === "user";
}
```

- [ ] **Step 4: Modify the trigger condition to use turn detection**

Update the `wrapModelCall` function in `src/middleware/compact-middleware/index.ts` around line 210:

```typescript
// Run cascade if:
// 1. Last message is from user (new turn started), AND
// 2. Either:
//    a. Above usage threshold, OR
//    b. We haven't checked in a while (every 10 messages)
const shouldRun =
  isNewTurn(messages) &&
  (usageRatio > 0.5 ||
    currentMessageCount - state.lastMessageCount >= 10);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/middleware/compact-middleware/turn-detection.test.ts`

Expected: PASS (compaction only runs once per turn)

- [ ] **Step 6: Commit**

```bash
git add src/middleware/compact-middleware/index.ts src/middleware/compact-middleware/turn-detection.test.ts
git commit -m "fix(compaction): only run once per turn instead of on every model call"
```

---

### Task 2: Make cascade trigger threshold configurable

**Files:**
- Modify: `src/middleware/compact-middleware/config.ts:107-128`
- Modify: `src/middleware/compact-middleware/index.ts:116-125,210-213`

**Problem:** The cascade trigger threshold is hardcoded to `0.5` (50% of context window). This is too aggressive and should be configurable like the summarize trigger.

- [ ] **Step 1: Add `cascadeTrigger` to CompactionConfig interface**

Update `src/middleware/compact-middleware/config.ts`:

```typescript
export interface CompactionConfig {
  /** When to trigger compaction cascade (default: 50% of context window) */
  cascadeTrigger?: TriggerFormat;
  /** When to trigger LLM summarization (default: 85% of context window) */
  trigger?: TriggerFormat | TriggerFormat[];
  /** How many messages to keep after compaction (default: 10) */
  keep?: TriggerFormat;
  // ... rest of interface unchanged
}
```

- [ ] **Step 2: Add default value to DEFAULT_COMPACTION_CONFIG**

Update `src/middleware/compact-middleware/config.ts`:

```typescript
export const DEFAULT_COMPACTION_CONFIG: Required<CompactionConfig> = {
  cascadeTrigger: { type: "fraction", value: 0.7 }, // 70% is more reasonable than 50%
  trigger: { type: "fraction", value: 0.85 },
  keep: { type: "messages", value: 10 },
  // ... rest unchanged
};
```

- [ ] **Step 3: Update middleware to use cascadeTrigger from config**

Update `src/middleware/compact-middleware/index.ts`:

```typescript
export function createCompactionMiddleware(
  options: CompactionMiddlewareOptions,
) {
  const { model, modelName, config: userConfig } = options;

  // Merge user config with defaults
  const config: CompactionConfig = {
    ...DEFAULT_COMPACTION_CONFIG,
    ...userConfig,
    // ... rest of merge logic unchanged
  };

  // ... inside wrapModelCall, replace the hardcoded 0.5:

  const cascadeThreshold = calculateTokenThreshold(
    config.cascadeTrigger,
    effectiveModelName,
  );
  const usageRatio = currentTokens / contextSize;

  const shouldRun =
    isNewTurn(messages) &&
    (usageRatio >= cascadeThreshold.value / contextSize ||
      currentMessageCount - state.lastMessageCount >= 10);
```

Wait, the calculation above is wrong. Let me fix it:

```typescript
  const cascadeThresholdTokens = calculateTokenThreshold(
    config.cascadeTrigger,
    effectiveModelName,
  );
  const usageRatio = currentTokens / contextSize;

  const shouldRun =
    isNewTurn(messages) &&
    (currentTokens >= cascadeThresholdTokens ||
      currentMessageCount - state.lastMessageCount >= 10);
```

- [ ] **Step 4: Update deepagents.ts to configure cascadeTrigger**

Update `src/harness/deepagents.ts:236-272`:

```typescript
    createCompactionMiddleware({
      model: chatModel,
      modelName: modelConfig.model || "gpt-4o",
      config: {
        // Cascade trigger (when to start compaction at all)
        cascadeTrigger: process.env.COMPACTION_CASCADE_TRIGGER_FRACTION
          ? {
              type: "fraction",
              value: Number.parseFloat(process.env.COMPACTION_CASCADE_TRIGGER_FRACTION),
            }
          : { type: "fraction", value: 0.7 },
        // Summarize trigger (when to use expensive LLM summarization)
        trigger: process.env.COMPACTION_TRIGGER_FRACTION
          ? {
              type: "fraction",
              value: Number.parseFloat(process.env.COMPACTION_TRIGGER_FRACTION),
            }
          : { type: "fraction", value: 0.85 },
        // ... rest unchanged
      },
    }),
```

- [ ] **Step 5: Update .env.example with new variable**

Add to `.env.example`:

```bash
# Compaction cascade trigger (default: 0.7 = 70% of context)
COMPACTION_CASCADE_TRIGGER_FRACTION=0.7
```

- [ ] **Step 6: Commit**

```bash
git add src/middleware/compact-middleware/config.ts src/middleware/compact-middleware/index.ts src/harness/deepagents.ts .env.example
git commit -m "feat(compaction): make cascade trigger threshold configurable"
```

---

### Task 3: Improve error logging to show actual error messages

**Files:**
- Modify: `src/middleware/compact-middleware/index.ts:249-253`

**Problem:** Errors are logged as `{}` because pino doesn't serialize non-Error objects properly.

- [ ] **Step 1: Add error serialization helper**

Add to `src/middleware/compact-middleware/index.ts`:

```typescript
/**
 * Serialize error for logging (handles both Error and plain objects).
 */
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (error && typeof error === "object") {
    return error as Record<string, unknown>;
  }

  return { error: String(error) };
}
```

- [ ] **Step 2: Update error logging to use the helper**

Update the catch block in `src/middleware/compact-middleware/index.ts`:

```typescript
        } catch (error) {
          logger.error(
            {
              error: serializeError(error),
              threadId,
            },
            "[compact-middleware] Compaction failed, proceeding with original messages",
          );
          // Continue with original messages on error
        }
```

- [ ] **Step 3: Commit**

```bash
git add src/middleware/compact-middleware/index.ts
git commit -m "fix(compaction): improve error logging to show actual error messages"
```

---

### Task 4: Add integration test to verify compaction doesn't run too early

**Files:**
- Create: `src/middleware/compact-middleware/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { createCompactionMiddleware } from "./index";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("Compaction Integration", () => {
  it("should not run compaction on conversations with only 3 turns", async () => {
    const model = await ChatOpenAI.initialize({
      model: "gpt-4o",
      apiKey: "test",
    });

    // Set cascade trigger to 70%
    const middleware = createCompactionMiddleware({
      model,
      config: {
        cascadeTrigger: { type: "fraction", value: 0.7 },
        trigger: { type: "fraction", value: 0.85 },
      },
    });

    let compactionRan = false;
    const originalLog = console.info;
    console.info = (...args: any[]) => {
      if (args[0]?.includes?.("Running compaction cascade")) {
        compactionRan = true;
      }
      originalLog(...args);
    };

    try {
      const handler = vi.fn().mockResolvedValue({ content: "response" });

      // Simulate 3 turns (each has user message + AI response)
      for (let i = 0; i < 3; i++) {
        const messages: any[] = [];
        for (let j = 0; j <= i; j++) {
          messages.push(new HumanMessage(`turn ${j}`));
          messages.push(new AIMessage(`response ${j}`));
        }

        await middleware.wrapModelCall!(
          {
            messages,
            configurable: { thread_id: "test-thread" },
          },
          handler,
        );
      }

      // Compaction should NOT have run (only 3 turns, well below 70% threshold)
      expect(compactionRan).toBe(false);
    } finally {
      console.info = originalLog;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test src/middleware/compact-middleware/integration.test.ts`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/middleware/compact-middleware/integration.test.ts
git commit -m "test(compaction): add integration test to verify compaction doesn't run too early"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Fix compaction running multiple times per turn (Task 1)
- ✅ Make cascade trigger configurable (Task 2)
- ✅ Improve error logging (Task 3)
- ✅ Add tests to verify behavior (Task 4)

**2. Placeholder scan:**
- No TBD/TODO found
- All code steps include actual code
- All file paths are specified

**3. Type consistency:**
- `CompactionConfig` interface properly updated
- `calculateTokenThreshold` signature matches usage
- Error types handled correctly

---

## Verification

After implementing all tasks, verify:

1. Run all tests: `bun test src/middleware/compact-middleware/`
2. Check that compaction only runs once per turn
3. Verify error messages are now visible in logs
4. Test with a real conversation to confirm compaction doesn't run too early
