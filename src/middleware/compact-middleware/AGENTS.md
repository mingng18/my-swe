# Compact Middleware

**Purpose**: Context compaction middleware that implements Claude Code's 4-level compaction cascade as LangChain middleware for DeepAgents.

## Overview

Compact middleware solves the context window problem for long-running AI agents. Instead of a generic single-pass summary, it uses a battle-tested 4-level cascade that preserves critical information while achieving 10x token reduction.

## Architecture

### 4-Level Compaction Cascade

```
Every Turn → COLLAPSE → TRUNCATE → MICROCOMPACT → (Token Threshold Exceeded?) → SUMMARIZE
```

1. **COLLAPSE** (Free) - Groups consecutive tool results (e.g., `[5 × read_file]`) into badge summaries
2. **TRUNCATE** (Free) - Shortens large tool arguments in old messages
3. **MICROCOMPACT** (Free) - Clears stale tool results based on time gaps (default: 60 minutes)
4. **SUMMARIZE** (LLM) - Only when token threshold exceeded; uses 9-section structured prompt

### 9-Section Summary Prompt

The SUMMARIZE level uses a structured prompt that preserves what agents actually need:

1. Primary Request & Intent - What the user asked for
2. Key Technical Concepts - Frameworks, patterns, technologies
3. Files & Code Sections - Paths with line numbers, why they matter
4. Errors & Fixes - What broke and how it was resolved
5. Problem Solving - Debugging strategies used
6. All User Messages - Verbatim non-tool messages (catches intent drift)
7. Pending Tasks - What's still incomplete
8. Current Work - Exactly where things left off
9. Optional Next Step - Direct quotes to prevent task drift

### Hybrid Token Counting

- Real API token counts from `response_metadata.usage` (when available)
- Heuristic estimation (chars / 4) for messages without real counts
- Walks messages backward to find last AI message with real usage

### Post-Compaction Restoration

After SUMMARIZE level:
- Re-reads top 5 recent files (configurable)
- Re-attaches active plan state
- Ensures continuity without losing important context

## Usage

### Basic Integration

```typescript
import { createCompactionMiddleware } from "./middleware/compact-middleware";
import { createChatModel } from "./utils/model-factory";

const model = await createChatModel({ model: "claude-sonnet-4-6" });

const compactMiddleware = createCompactionMiddleware({
  model,
  modelName: "claude-sonnet-4-6",
});

// Add to middleware array in DeepAgents config
const agent = createDeepAgent({
  model,
  tools,
  middleware: [compactMiddleware, ...otherMiddleware],
});
```

### Custom Configuration

```typescript
import { createCompactionMiddleware } from "./middleware/compact-middleware";

const compactMiddleware = createCompactionMiddleware({
  model,
  modelName: "claude-sonnet-4-6",
  config: {
    // Trigger at 80% of context window (default: 0.85)
    trigger: { type: "fraction", value: 0.80 },

    // Keep last 15 messages after compaction (default: 10)
    keep: { type: "messages", value: 15 },

    // Maximum consecutive failures before circuit breaker (default: 3)
    maxConsecutiveFailures: 5,

    // Custom summary instructions
    customInstructions: "Focus on code diffs and test output. Include file paths verbatim.",

    // Microcompaction settings
    microcompact: {
      enabled: true,
      gapThresholdMinutes: 30,  // Clear after 30 min gap (default: 60)
      keepRecent: 3,             // Keep last 3 results (default: 5)
    },

    // Truncation settings
    truncateArgs: {
      enabled: true,
      maxLength: 1000,  // Max chars per arg (default: 2000)
    },

    // Restoration settings
    restoration: {
      enabled: true,
      maxFiles: 3,  // Re-read 3 files (default: 5)
    },
  },
});
```

### Monitoring

```typescript
import {
  getThreadMetadata,
  getAllThreadStates,
  cleanupThreadState,
} from "./middleware/compact-middleware";

// Get metadata for a specific thread
const metadata = getThreadMetadata(threadId);
console.log(`Compaction reduced tokens by ${metadata.originalTokens - metadata.compactedTokens}`);

// Get all thread states (for debugging/monitoring)
const allStates = getAllThreadStates();

// Clean up when thread is done
cleanupThreadState(threadId);
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trigger` | `TriggerFormat \| TriggerFormat[]` | `{type: "fraction", value: 0.85}` | When to trigger SUMMARIZE level |
| `keep` | `TriggerFormat` | `{type: "messages", value: 10}` | Messages to keep after SUMMARIZE |
| `maxConsecutiveFailures` | `number` | `3` | Circuit breaker threshold |
| `customInstructions` | `string` | `""` | Additional summary prompt instructions |
| `suppressFollowUpQuestions` | `boolean` | `false` | Don't add follow-up prompt after compaction |
| `microcompact.enabled` | `boolean` | `true` | Enable time-based tool result clearing |
| `microcompact.gapThresholdMinutes` | `number` | `60` | Clear results after gap (minutes) |
| `microcompact.keepRecent` | `number` | `5` | Always keep N recent results |
| `truncateArgs.enabled` | `boolean` | `true` | Enable argument truncation |
| `truncateArgs.maxLength` | `number` | `2000` | Max chars per argument |
| `collapse.enabled` | `boolean` | `true` | Enable message collapsing |
| `collapse.minGroupSize` | `number` | `2` | Min consecutive reads to collapse |
| `restoration.enabled` | `boolean` | `true` | Enable post-compaction restoration |
| `restoration.maxFiles` | `number` | `5` | Files to re-read after SUMMARIZE |
| `restoration.fileBudgetChars` | `number` | `30000` | Total budget for restored content |

## Trigger Formats

```typescript
// Absolute token count
{ type: "tokens", value: 150000 }

// Fraction of context window
{ type: "fraction", value: 0.85 }

// Message count
{ type: "messages", value: 50 }

// Multiple triggers (any fires)
[
  { type: "fraction", value: 0.85 },
  { type: "messages", value: 100 }
]
```

## Module Structure

```
src/middleware/compact-middleware/
├── index.ts          # Main middleware, state management
├── config.ts         # Configuration types and defaults
├── tokens.ts         # Hybrid token counting
├── prompts.ts        # 9-section summary prompts
├── collapse.ts       # Message collapsing (Level 1)
├── truncation.ts     # Argument truncation (Level 2)
├── microcompact.ts   # Time-based clearing (Level 3)
├── compaction.ts     # LLM summarization (Level 4)
├── restoration.ts    # Post-compaction restoration
├── decision.ts       # Cascade orchestration
└── AGENTS.md         # This file
```

## Environment Variables

No dedicated environment variables. Uses LangChain middleware integration.

## Testing

```bash
# Run tests
bun test src/middleware/compact-middleware/*.test.ts

# Token counting tests
bun test src/middleware/compact-middleware/tokens.test.ts

# Full cascade integration test
bun test src/middleware/compact-middleware/integration.test.ts
```

## Performance Impact

- **Free levels (1-3)**: ~10-50ms per turn (message iteration)
- **SUMMARIZE level**: ~2-5 seconds (LLM call, triggered rarely)
- **Token reduction**: 60-90% for long conversations
- **Circuit breaker**: Prevents runaway failed compactions

## Comparison with Built-in Middleware

| Feature | `SummarizationMiddleware` | Compact Middleware |
|---------|---------------------------|-------------------|
| Summary prompt | Generic | 9-section structured |
| Pre-summarization optimization | — | Collapse + Truncate + Microcompact |
| Post-compaction restoration | — | Files + Plans |
| Circuit breaker | — | Configurable (default: 3 failures) |
| Token counting | Heuristic only | Hybrid (real API + heuristic) |
| Partial compaction | — | Prefix/suffix modes |
| Custom instructions | — | Yes |

## Original Python Implementation

This is a TypeScript port of: https://github.com/emanueleielo/compact-middleware

Key adaptations:
- LangChain middleware API instead of DeepAgents Python middleware
- TypeScript types for configuration
- Integration with existing Bullhorse middleware pipeline
- Uses `createMiddleware` from `langchain` package
