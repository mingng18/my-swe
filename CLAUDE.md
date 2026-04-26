# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Bullhorse** is an agentic coder + deterministic linter pipeline built with LangGraph. It can be deployed as a Telegram bot, HTTP API, or to LangGraph Cloud.

The graph follows a two-node pipeline: `coder` (agentic LLM reasoning via a pluggable harness, default **OpenCode**) → `linter` (deterministic shell command for verification).

## Common Commands

```bash
# Development with hot reload
bun run dev

# Start production server
bun run start

# Run tests
bun test

# LangGraph development server
langgraph dev

# Docker
make docker-build && make docker-run

# TypeScript check (default linter)
bunx tsc --noEmit
```

## Architecture

### Graph Structure (LangGraph StateGraph)
- **Entry point**: `src/server.ts:getGraph()` - compiled LangGraph for LangGraph Platform
- **State**: `src/utils/state.ts` - defines `CodeagentState` with `input`, `reply`, `error` fields
- **Nodes**:
  - `src/nodes/coder.ts` - Agentic node using DeepAgents SDK
  - `src/nodes/linter.ts` - Deterministic node running shell commands

### Agent Harness Pattern
The `coder` node uses an `AgentHarness` abstraction (`src/harness/agentHarness.ts`) to support pluggable agent backends:
- **Provider factory**: `src/harness/index.ts` - selects backend via `AGENT_PROVIDER`
- **OpenCode** (default): `src/harness/opencode.ts` - uses `@opencode-ai/sdk`
- **DeepAgents** (optional fallback): `src/harness/deepagents.ts` - uses `deepagents` npm package with FilesystemBackend
- Tools are registered in `src/tools/index.ts` and passed to the DeepAgent constructor

### Transport Layers
- **Hono webapp**: `src/webapp.ts` - HTTP API with endpoints for `/run`, `/health`, `/info`, `/v1/chat/completions`, and webhooks
- **Telegram**: Long polling mode for local development (`src/index.ts`), webhook mode for production (`src/webapp.ts`)

### GitHub Integration
- Tools support `--repo owner/name` syntax for repo targeting
- Bare `--repo name` uses `GITHUB_DEFAULT_OWNER` env var
- Repo state persists per thread via `threadRepoMap` in `src/harness/deepagents.ts`

## LLM Configuration

Uses OpenAI-compatible API trio (works with OpenAI, OpenRouter, Z.ai GLM):
- `OPENAI_BASE_URL` - API base URL (include `/v1` if required)
- `OPENAI_API_KEY` - API key for that host
- `MODEL` - Model identifier

The model string is prefixed with `openai:` in `src/harness/deepagents.ts` to force LangChain's provider inference.

## Langfuse Observability

Bullhorse integrates Langfuse for comprehensive LLM observability. The integration uses LangChain's automatic callback tracing.

### Configuration

Set these environment variables to enable Langfuse:

```bash
# Required for Langfuse tracing
LANGFUSE_PUBLIC_KEY=pk-xxx
LANGFUSE_SECRET_KEY=sk-xxx

# Optional: Langfuse host (for self-hosted or EU region)
LANGFUSE_HOST=https://cloud.langfuse.com
```

### What Gets Traced

- **LLM calls** — Automatic token usage, latency, and model tracking
- **Tool invocations** — Tool names, arguments, results, and duration
- **Agent turns** — Session-based traces with transport metadata
- **User attribution** — UserId from Telegram, HTTP headers, or GitHub webhooks

### Sensitive Data Masking

API keys, tokens, and passwords are automatically masked before being sent to Langfuse. The masking patterns include:
- Bearer tokens
- OpenAI-style API keys (`sk-...`)
- Langfuse keys (`pk-...`, `sk-...`)
- Generic `api_key`, `token`, and `password` fields

### Viewing Traces

Access your traces at the Langfuse dashboard:
- Cloud: https://cloud.langfuse.com
- Self-hosted: Your `LANGFUSE_HOST` value

### Environment Setup

- **Development:** Enable for debugging and testing
- **Staging:** Leave credentials empty to disable
- **Production:** Enable for monitoring and analytics

## Adding New Tools

Create tool functions in `src/tools/` and export them. Tools are LangChain-compatible functions passed to DeepAgents via the `tools` array in `createDeepAgent()`.

## Subagents

Bullhorse supports subagents for specialized tasks:

### Built-in Subagents

| Agent | Description |
|-------|-------------|
| explore-agent | Fast, read-only codebase exploration. Use for finding files and searching code. |
| plan-agent | Software architect for implementation planning. Creates step-by-step plans with critical files. |
| general-purpose | Versatile research and multi-step tasks. Has access to all tools. |
| verification-agent | Async verification that runs tests, linters, and adversarial probes. |
| code-reviewer | General code quality, security, and maintainability |
| database-reviewer | PostgreSQL optimization and schema design |
| security-reviewer | OWASP Top 10 and vulnerability detection |
| go-reviewer | Idiomatic Go, concurrency, and error handling |
| python-reviewer | PEP 8 compliance and Pythonic patterns |

### Usage

The main agent automatically delegates to appropriate subagents. Enable with:

```bash
SUBAGENTS_ENABLED=true
ASYNC_SUBAGENTS_ENABLED=true
```

### Custom Agents

Define repo-specific agents in `.agents/agents/*.md`:

```markdown
---
name: my-custom-agent
description: Specialized agent for X
tools: [code_search, semantic_search]
---

System prompt here...
```

## Blueprint System

Bullhorse uses a blueprint system inspired by [Stripe Minions](https://stripe.com/blog/minions). Blueprints define state machine workflows that intermix agent nodes and deterministic nodes.

**📚 For comprehensive documentation, including API reference, examples, and advanced usage, see [docs/blueprints.md](docs/blueprints.md).**

### Usage

```typescript
import { loadBlueprints, selectBlueprint, compileBlueprint } from './blueprints';

const blueprints = await loadBlueprints();
const selection = selectBlueprint(task, blueprints);
const graph = compileBlueprint(selection.blueprint, actionRegistry);
await graph.invoke({ input: task, currentState: selection.blueprint.initialState });
```

### Default Blueprints

- `bug-fix` - Fix bugs with verification loop
- `feature` - Implement new features
- `refactor` - Code restructuring
- `test` - Add tests
- `docs` - Documentation changes
- `chore` - Maintenance tasks
- `default` - Fallback for general tasks

## Environment Setup

Copy `.env.example` to `.env` and configure:
- Required for LLM: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `MODEL`
- Required for Telegram: `TELEGRAM_BOT_TOKEN`
- Optional for GitHub: `GITHUB_TOKEN`, `GITHUB_DEFAULT_OWNER`, `GITHUB_WEBHOOK_SECRET`
- Optional: `PORT` (default 7860), `WEBHOOK_URL`, `WORKSPACE_ROOT`, `LINTER_COMMAND`

## Deployment

LangGraph Platform uses `langgraph.json` config:
- Graph: `src/server.ts:getGraph`
- HTTP app: `src/webapp.ts:default`
- Node version: 22
- Environment: `.env`

## Performance Optimizations

Bullhorse implements several layers of optimization to reduce token usage and improve reliability:

### Memory Pointer Pattern

- Large tool responses (>5k tokens) stored as disk artifacts
- Reference via short pointer IDs (e.g., `ptr_abc123`)
- Query tools: `artifact_query`, `artifact_list`, `artifact_delete`
- **Result**: 70-90% token reduction for large responses

### Progressive Context Compaction

- Intelligent message importance scoring (user messages +10, final AI +8, etc.)
- Keeps last 30 messages + top 20 by importance
- Triggers at 50k tokens (configurable)
- **Result**: 10x more context retained vs binary cleanup

### Semantic Search

- Term frequency analysis for conceptual code search
- Use `semantic_search` for: "where is auth implemented?"
- Use `code_search` for: "find AuthMiddleware class"
- **Result**: 97% reduction in file discovery tokens

### Token Budgeting

- Per-thread limits: `MAX_TOKENS_PER_THREAD=500000`
- Cost enforcement: `MAX_COST_PER_THREAD=10.0`
- Pre-flight budget checks before LLM calls

### Telemetry & Metrics

- `GET /metrics/thread/:threadId` - Per-thread metrics
- `GET /metrics` - Global metrics
- `GET /dashboard/thread/:threadId` - Visual dashboard
- Built-in pricing for OpenAI, Claude, DeepSeek models

## Agent Skills

Bullhorse supports a skills system that provides reusable, detailed instructions for common tasks. Skills are discovered from `.agents/skills/*.md` files and can be activated on-demand.

### How Skills Work

1. **Discovery**: Skills are automatically discovered from `.agents/skills/` directories at startup
2. **Catalog**: A lightweight catalog of available skills is included in the system prompt
3. **Activation**: When a task matches a skill's description, the agent uses `activate_skill` to load full instructions
4. **Protection**: Skill content is protected from context compaction to ensure it remains available

### Creating Skills

Skills are Markdown files with YAML frontmatter:

```markdown
---
name: my-skill
description: A brief description of what this skill does
version: 1.0.0
tags: [tag1, tag2]
---

# Detailed Skill Instructions

This is where you put the detailed instructions that the agent should follow when this skill is activated.
```

Place skill files in `.agents/skills/<skill-name>/SKILL.md` or `.agents/skills/<skill-name>.md`.

### Example Skills

The repository includes example skills in `.agents/skills/`:
- `test-driven-development/` - TDD best practices
- `systematic-debugging/` - Debugging workflows
- `writing-plans/` - Planning techniques
- `subagent-driven-development/` - Multi-agent patterns
- And many more...

### Skill Activation

Skills are activated automatically by the agent when it recognizes a task that matches a skill's description. The agent uses the `activate_skill` tool to load the full skill content.

## New Tools

| Tool | Purpose |
| :--- | :--- |
| `activate_skill` | Load and activate a skill by name |
| `semantic_search` | Conceptual code search (by meaning, not pattern) |
| `artifact_query` | Query stored memory pointers |
| `artifact_list` | List all artifacts for current thread |
| `artifact_delete` | Delete a specific artifact |

## Cache Utility

Bullhorse provides a generic LRU (Least Recently Used) cache utility for caching API responses, file contents, and computational results. The cache supports size-based eviction, TTL expiration, and pattern-based invalidation.

### Core Features

- **LRU Eviction**: Automatically removes least recently used entries when size limit is reached
- **TTL Expiration**: Time-based expiration for cached entries
- **Parameterized Keys**: Cache keys can include parameters for granular caching
- **Statistics**: Track hits, misses, and hit ratios for performance monitoring
- **Pattern Invalidation**: Bulk invalidation using regex patterns

### Basic Usage

```typescript
import { GenericCache, createCache } from './utils/cache/lru-cache';

// Create a cache instance
const cache = new GenericCache({
  maxSize: 100 * 1024 * 1024, // 100MB
  ttl: 30 * 60 * 1000, // 30 minutes
  debug: "MyCache", // Optional debug logging
});

// Or use the factory function
const cache = createCache({ ttl: 60 * 60 * 1000 });

// Store and retrieve values
cache.set("user:123", { name: "Alice", email: "alice@example.com" });
const user = cache.get<{ name: string; email: string }>("user:123");

// Check if key exists
if (cache.has("user:123")) {
  console.log("User data is cached");
}

// Delete specific entry
cache.delete("user:123");

// Clear all entries
cache.clear();
```

### Parameterized Cache Keys

Cache entries can be parameterized for granular caching:

```typescript
// Same endpoint, different parameters are cached separately
cache.set("api/users", page1Data, { page: 1, limit: 10 });
cache.set("api/users", page2Data, { page: 2, limit: 10 });

const page1 = cache.get("api/users", { page: 1, limit: 10 });
const page2 = cache.get("api/users", { page: 2, limit: 10 });

// Parameters are sorted alphabetically in the cache key
// Key format: "api/users?page=1&limit=10"
```

### Caching Function Calls

Use `cachedCall` to automatically cache expensive operations:

```typescript
import { cachedCall } from './utils/cache/lru-cache';

const cache = new GenericCache();

async function fetchUser(userId: string) {
  return await cachedCall(
    cache,
    "user", // Base cache key
    { userId }, // Parameters
    async () => {
      // Only called on cache miss
      const response = await fetch(`/api/users/${userId}`);
      return response.json();
    }
  );
}

// First call executes the function
const user1 = await fetchUser("123");

// Subsequent calls return cached value
const user2 = await fetchUser("123");
```

### Conditional Caching

Use `conditionalCachedCall` to selectively bypass cache:

```typescript
import { conditionalCachedCall } from './utils/cache/lru-cache';

async function apiCall(method: string, endpoint: string, params: object) {
  return await conditionalCachedCall(
    cache,
    method === "GET", // Only cache GET requests
    endpoint,
    params,
    async () => fetchApi(method, endpoint, params)
  );
}
```

### Pattern-Based Invalidation

Invalidate multiple cache entries matching a regex pattern:

```typescript
// Invalidate all user-related cache entries
cache.invalidate("user:.*");

// Invalidate all entries for a specific repository
cache.invalidate("repos/owner/repo/.*");

// Invalidate all pagination results for an endpoint
cache.invalidate("api/users.*page=");

// Returns the number of entries invalidated
const count = cache.invalidate("user:.*");
console.log(`Invalidated ${count} entries`);
```

### Cache Statistics

Monitor cache performance with built-in statistics:

```typescript
const stats = cache.getStats();

console.log(`Entries: ${stats.size} / ${stats.maxSize} bytes`);
console.log(`Calculated size: ${stats.calculatedSize} bytes`);
console.log(`Hits: ${stats.hits}, Misses: ${stats.misses}`);
console.log(`Hit ratio: ${(stats.hitRatio * 100).toFixed(1)}%`);
console.log(`TTL: ${stats.ttl}ms`);

// Reset counters for periodic monitoring
cache.resetStats();
```

### Environment Configuration

Configure default cache behavior via environment variables:

```bash
# Cache defaults (used when options not provided)
CACHE_DEFAULT_MAX_SIZE_MB=50        # Default: 50MB
CACHE_DEFAULT_TTL_MS=900000         # Default: 15 minutes (900000ms)
CACHE_DEBUG=true                    # Enable debug logging
```

Priority order (highest to lowest):
1. User-provided options (in constructor)
2. Environment variables
3. Hardcoded defaults (50MB, 15 minutes)

### GitHub API Cache Example

The GitHub API cache demonstrates real-world usage:

```typescript
import { githubApiCache, cachedGithubApiCall, invalidateRepoCache } from './utils/github/github-cache';

// Automatic caching for GET requests
async function fetchRepo(owner: string, repo: string) {
  return await cachedGithubApiCall(
    "GET",
    `repos/${owner}/${repo}`,
    { owner, repo },
    async () => await octokit.request(`GET /repos/${owner}/${repo}`)
  );
}

// Invalidate cache after mutations
async function createIssue(owner: string, repo: string, title: string) {
  const result = await octokit.request(`POST /repos/${owner}/${repo}/issues`, { title });
  invalidateRepoCache(owner, repo); // Clear stale cache
  return result;
}

// Monitor cache effectiveness
const stats = githubApiCache.getStats();
console.log(`GitHub API cache hit ratio: ${(stats.hitRatio * 100).toFixed(1)}%`);
```

### Best Practices

1. **Cache Size**: Set appropriate `maxSize` based on available memory and data volume
2. **TTL**: Use shorter TTLs (5-15 minutes) for rapidly changing data
3. **Invalidation**: Always invalidate cache after mutations (POST/PUT/DELETE)
4. **Parameters**: Include all parameters that affect the result in the cache key
5. **Monitoring**: Regularly check `getStats()` to ensure cache is effective
6. **Debug**: Enable debug logging during development to understand cache behavior

### Testing

The cache utility includes comprehensive tests:

```bash
# Run cache tests
bun test src/utils/cache/__tests__/lru-cache.test.ts
```

## New Environment Variables

```bash
# Memory Pointer Pattern
MEMORY_POINTER_TTL_HOURS=24
MAX_POINTER_SIZE_TOKENS=5000

# Context Compaction
CONTEXT_COMPACTION_THRESHOLD=50000
CONTEXT_KEEP_MINIMUM=30
CONTEXT_KEEP_IMPORTANT=20

# Token Budgeting
MAX_TOKENS_PER_THREAD=500000
MAX_COST_PER_THREAD=10.0

# Semantic Search
SEMANTIC_SEARCH_ENABLED=true

# Skills
SKILLS_ENABLED=true
SKILLS_PATH=.agents/skills

# Cache Utility
CACHE_DEFAULT_MAX_SIZE_MB=50
CACHE_DEFAULT_TTL_MS=900000
CACHE_DEBUG=true

# Telemetry
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_SERVICE_NAME=bullhorse-agent
```
