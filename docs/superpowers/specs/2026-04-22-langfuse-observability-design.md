# Langfuse Observability Integration

**Date:** 2026-04-22
**Status:** Approved
**Author:** Claude (with user requirements)

## Overview

Integrate Langfuse for comprehensive LLM observability across Bullhorse's agentic coding pipeline. The integration uses LangChain's automatic callback tracing to capture token usage, latency, tool calls, and conversation flows with minimal code changes.

## Goals

1. **Debugging & Development** — Detailed traces to debug agent behavior, understand token usage, and optimize performance
2. **Production Monitoring** — High-level metrics and dashboards for operational observability
3. **User Analytics** — Track user sessions, conversation flows, and aggregate usage patterns
4. **Cost Management** — Monitor token costs across models and users

## Requirements

| Requirement | Priority | Notes |
|-------------|----------|-------|
| Auto-tracing via LangChain callback | P0 | Minimal code, comprehensive coverage |
| Token usage & cost metrics | P0 | Per-model, per-thread, aggregated |
| Thread-based sessions | P0 | Use existing `threadId` as Langfuse `sessionId` |
| All transports instrumented | P0 | Telegram, HTTP, GitHub webhooks |
| Basic PII masking | P1 | API keys, tokens, passwords |
| Non-blocking flush | P0 | Never delay agent responses |
| Dev + Production only | P1 | Skip staging to reduce duplicate test data |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Transport Layer                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐              │
│  │ Telegram │  │   HTTP   │  │ GitHub Webhooks  │              │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘              │
│       │             │                  │                         │
│       └─────────────┴──────────────────┘                         │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DeepAgents Harness                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  createDeepAgent(config)                                   │ │
│  │    - model: ChatModel                                      │ │
│  │    - tools: [...]                                          │ │
│  │    - middleware: [...]                                     │ │
│  │    - callbacks: [LangfuseLangChain()]  ← NEW              │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Langfuse Tracing Layer                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  LangfuseLangChain Callback                                │ │
│  │    ├── Auto-traces all LLM calls (generations)            │ │
│  │    ├── Auto-traces all tool calls (spans)                 │ │
│  │    ├── Auto-captures token usage                           │ │
│  │    └── Auto-captures latency                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Custom Trace (existing)                                   │ │
│  │    - Session: threadId                                     │ │
│  │    - User: transport-specific ID                           │ │
│  │    - Metadata: blueprint, repo, transport                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Langfuse Dashboard                           │
│  • Token usage per model/thread/transport                       │
│  • Latency metrics (LLM, tool, total)                          │
│  • Conversation replay & debugging                             │
│  • Cost aggregation                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. LangChain Callback Registration
**File:** `src/harness/deepagents.ts`

Add `LangfuseLangChain` callback to the agent configuration in `createAgentInstance()`.

```typescript
import { LangfuseLangChain } from "langfuse";

// In createAgentInstance(), add to config:
const config: any = {
  // ... existing config
  callbacks: [new LangfuseLangChain()],
};
```

### 2. Enhanced Trace Metadata
**File:** `src/harness/deepagents.ts`

Extend the existing trace creation with transport-specific metadata.

**Current trace:**
```typescript
const langfuseTrace = isLangfuseEnabled()
  ? createTrace("agent-turn", threadId)
  : null;
```

**Enhanced trace:**
```typescript
const langfuseTrace = isLangfuseEnabled()
  ? createTrace("agent-turn", threadId, userId)  // Add userId
  : null;

// Update with metadata
langfuseTrace?.update({
  input: maskedInput,
  metadata: {
    transport: "telegram" | "http" | "github",
    blueprint: blueprintSelection.blueprint.id,
    repo: activeRepo ? `${activeRepo.owner}/${activeRepo.name}` : undefined,
  },
});
```

### 3. Transport-Specific User IDs

| Transport | User ID Source | Implementation |
|-----------|----------------|----------------|
| Telegram | `update.message.from.id` | Extract in `src/index.ts` |
| HTTP | `X-User-Id` header or session ID | Extract in `src/webapp.ts` |
| GitHub | `payload.sender.login` | Extract in webhook handler |

### 4. Sensitive Data Masking
**File:** `src/utils/langfuse.ts`

Add a helper function to mask sensitive fields before sending traces to Langfuse.

```typescript
const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+/gi,
  /sk-[A-Za-z0-9]{32,}/g,
  /pk-[A-Za-z0-9]{32,}/g,
  /api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9]{20,}/gi,
  /token["']?\s*[:=]\s*["']?[A-Za-z0-9]{20,}/gi,
  /password["']?\s*[:=]\s*["']?[^\s"']{8,}/gi,
];

export function maskSensitiveData(text: string): string {
  let masked = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, "***REDACTED***");
  }
  return masked;
}
```

### 5. Environment Configuration

**Existing `.env.example` entries (no changes needed):**
```bash
# Langfuse Observability
LANGFUSE_PUBLIC_KEY=pk-xxx
LANGFUSE_SECRET_KEY=sk-xxx
LANGFUSE_HOST=https://cloud.langfuse.com
```

**Per-environment setup:**
- **Development:** Set credentials, `LANGFUSE_ENABLED` defaults to `true`
- **Staging:** Leave credentials empty (auto-disabled)
- **Production:** Set credentials, `LANGFUSE_ENABLED` defaults to `true`

### 6. Flush Handlers

**No changes needed** — existing handlers remain:
- `flushLangfuse()` called after each agent turn (non-blocking)
- `shutdownLangfuse()` called in `cleanupDeepAgents()` on process exit

## Data Flow

```
1. User sends message via transport (Telegram/HTTP/GitHub)
   │
2. Transport extracts: userId, threadId, input
   │
3. DeepAgents harness invokes agent
   │
4. Langfuse trace created with:
   - name: "agent-turn"
   - sessionId: threadId
   - userId: transport-specific
   - metadata: { transport, repo?, blueprint?, maskedInput }
   │
5. LangChain callback auto-captures:
   - LLM calls → generations (tokens, latency, model)
   - Tool calls → spans (name, args, result, duration)
   │
6. Agent completes → trace updated with:
   - output: masked response
   - metadata: { messageCount, responseLength, totalDuration }
   │
7. flushLangfuse() called (non-blocking)
   │
8. Trace appears in Langfuse dashboard
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Langfuse disabled (no credentials) | No-op client, zero overhead |
| Langfuse API error | Log warning, continue execution |
| Missing/invalid credentials | Auto-disable, log info on startup |
| Flush timeout | Non-blocking, don't delay response |
| Invalid trace data | Log error, drop trace, don't fail agent |

**Key principle:** Langfuse failures will **never** block or delay agent responses.

## Testing Strategy

### Unit Tests
**File:** `src/utils/langfuse.test.ts`

- Test `isLangfuseEnabled()` with/without credentials
- Test `maskSensitiveData()` with various input patterns
- Test no-op client behavior when disabled

### Integration Tests
**File:** `src/harness/__tests__/deepagents.langfuse.test.ts`

- Mock Langfuse client, verify trace creation
- Verify callback registration in agent config
- Test flush behavior on successful/failed runs

### Manual Verification

1. Set Langfuse credentials in `.env`
2. Run agent: `bun run dev`
3. Send test message via Telegram or HTTP
4. Verify trace appears in Langfuse dashboard
5. Check: token accuracy, span hierarchy, metadata

### Environment Verification

| Environment | LANGFUSE_PUBLIC_KEY | Expected Behavior |
|-------------|---------------------|-------------------|
| Development | Set | Full tracing enabled |
| Staging | Empty | Disabled (no traces sent) |
| Production | Set | Full tracing enabled |

## Performance Considerations

- **Callback overhead:** Negligible (<1% of total latency)
- **Flush:** Non-blocking, runs in background
- **Network I/O:** Async to Langfuse API, doesn't block agent
- **Memory:** Minimal, traces are flushed after each turn

## Cost Management

- **Langfuse free tier:** Limited events per month
- **Monitoring:** Check event count in dashboard regularly
- **Future enhancement:** Consider sampling for high-traffic scenarios

## Data Retention

- **Langfuse cloud:** Configurable via dashboard (default: 30 days)
- **On-prem deployment:** Disk-based retention policies

## Future Enhancements (Out of Scope)

- Scoring/rating traces for user feedback
- Datasets for evaluation and testing
- Cost alerts by model/user threshold
- Sampling for high-traffic scenarios
- Export traces to external systems

## Implementation Checklist

- [ ] Add `LangfuseLangChain` import to `src/harness/deepagents.ts`
- [ ] Register callback in agent config
- [ ] Extract `userId` in transport handlers (Telegram, HTTP, GitHub)
- [ ] Add `maskSensitiveData()` helper to `src/utils/langfuse.ts`
- [ ] Enhance trace creation with metadata (transport, repo, blueprint)
- [ ] Apply masking to trace input/output
- [ ] Add unit tests for masking function
- [ ] Add integration tests for callback registration
- [ ] Manual verification in dev environment
- [ ] Update documentation (CLAUDE.md, README)

## Files to Modify

| File | Changes |
|------|---------|
| `src/harness/deepagents.ts` | Add callback, enhance trace metadata |
| `src/utils/langfuse.ts` | Add `maskSensitiveData()` function |
| `src/index.ts` | Extract Telegram userId |
| `src/webapp.ts` | Extract HTTP userId from header |
| `src/harness/__tests__/deepagents.langfuse.test.ts` | New file: integration tests |
| `src/utils/langfuse.test.ts` | New file: unit tests |
| `CLAUDE.md` | Document Langfuse integration |

## Rollback Plan

If issues arise:
1. Remove callback from agent config (1-line change)
2. Traces stop being sent, agent continues normally
3. No data loss — agent functionality unaffected
