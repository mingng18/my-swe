# Bullhorse Subagents Design

**Date:** 2026-04-10
**Status:** Design Approved
**Implementation Phases:** 4

## Overview

Implement a hybrid subagent system for Bullhorse that combines:
- **Synchronous subagents** for quick, interactive tasks (Explore, Plan, General-Purpose)
- **Asynchronous subagents** for long-running background tasks (Verification)
- **Repo-specific agents** defined via AGENTS.md files for extensibility

This design addresses the **context bloat problem** by isolating intermediate work (searches, exploration, verification) from the main agent's context window.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Main Agent (Coder)                       │
│  - Full tool access                                             │
│  - Delegates to subagents via task() tool                       │
│  - Coordinates workflow                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
    │ Explore │         │  Plan   │         │General  │
    │ (sync)  │         │ (sync)  │         │(sync)   │
    └─────────┘         └─────────┘         └─────────┘
         │                    │                    │
         └────────────────────┴────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Verification    │
                    │   (async)        │
                    │  start/check/    │
                    │   cancel         │
                    └──────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Repo-Specific    │
                    │  (AGENTS.md)      │
                    │  Custom agents    │
                    └──────────────────┘
```

## Built-in Subagents

### Explore Agent

**Purpose:** Fast, read-only codebase exploration

**When to use:**
- Finding files by patterns (e.g., `src/components/**/*.tsx`)
- Searching code for keywords (e.g., "API endpoints")
- Answering questions about codebase structure

**Configuration:**
- Model: `haiku` (fast, token-efficient)
- Tools: Read, Glob, Grep, Bash (read-only only)
- Disallowed: Edit, Write, NotebookEdit

**Thoroughness levels:**
- `quick` - Basic searches
- `medium` - Moderate exploration
- `very thorough` - Comprehensive analysis

### Plan Agent

**Purpose:** Software architecture and implementation planning

**When to use:**
- Planning implementation strategies
- Identifying critical files and dependencies
- Considering architectural trade-offs

**Configuration:**
- Model: `inherit` (uses main agent's model)
- Tools: Read, Glob, Grep, Bash (read-only only)
- Output: Always ends with "Critical Files for Implementation" list

### General-Purpose Agent

**Purpose:** Versatile research and multi-step tasks

**When to use:**
- Complex searches requiring multiple attempts
- Multi-step analysis workflows
- Tasks that benefit from delegation

**Configuration:**
- Model: `inherit`
- Tools: All tools except Agent spawning
- Cannot: Spawn other agents (prevents recursion)

### Verification Agent (Async)

**Purpose:** Adversarial verification specialist

**When to use:**
- After 3+ file edits
- Backend/API changes
- Infrastructure changes
- Any implementation requiring verification

**Configuration:**
- Model: `inherit`
- Execution: Async (non-blocking)
- Tools: Bash, Read, WebFetch, browser automation

**Workflow:**
1. Run build (automatic FAIL if broken)
2. Run test suite (automatic FAIL if failing)
3. Run linters/type-checkers
4. Run adversarial probes (concurrency, boundaries, idempotency)
5. Return verdict: `VERDICT: PASS/FAIL/PARTIAL`

## Repo-Specific Agents

**Directory:** `.agents/agents/`

**Format:** YAML frontmatter + markdown system prompt

```markdown
---
name: custom-security-reviewer
description: Specialized agent for security vulnerability detection
model: inherit
tools: [Read, Grep, Bash]
disallowedTools: [Edit, Write]
---

You are a security specialist focused on finding vulnerabilities...

Your workflow:
1. Check for SQL injection patterns
2. Verify input sanitization
3. Examine authentication flows
...
```

**Loading behavior:**
- Scanned at startup from `REPO_AGENTS_DIR` (default: `.agents/agents/`)
- Parsed and merged with built-in agents
- Repo agents with same name override built-ins (logged warning)

## Data Flow

### Synchronous Execution

```
User: "Refactor the auth system"
    │
    ▼
Main Agent → task("explore-agent", "Find all auth files")
    │
    ▼ (blocks)
Explore Agent → Returns: "Found auth in src/middleware/auth.ts, ..."
    │
    ▼
Main Agent → task("plan-agent", "Design refactoring plan")
    │
    ▼ (blocks)
Plan Agent → Returns strategy + critical files
    │
    ▼
Main Agent → Implements changes
    │
    ▼
Main Agent → start_async_task("verification-agent", "Verify changes")
    │
    ▼ (returns immediately)
{ taskId: "abc123", status: "running" }
    │
    ▼ (user continues or checks status)
Main Agent → "Verification running in background. Task ID: abc123"
```

### Async Execution

```
Main Agent calls start_async_task()
    │
    ▼
AsyncSubAgentMiddleware:
  1. Create new thread
  2. Start run with task description
  3. Return thread ID as task ID
  4. Store metadata in state channel
    │
    ▼ (returns immediately)
{ taskId: "abc123" }
    │
    ▼ (Verification agent works independently)
Verification Agent:
  1. Read docs
  2. Run build
  3. Run tests
  4. Run linters
  5. Run adversarial probes
  6. Return verdict
    │
    ▼ (user asks for update)
check_async_task(taskId="abc123")
→ Returns status or result
```

## Configuration

### langgraph.json

```json
{
  "graphs": {
    "bullhorse": "./src/server.ts:getGraph",
    "verification": "./src/subagents/verification/graph.ts:getVerificationGraph"
  },
  "env": ".env"
}
```

### Environment Variables

```bash
# Enable/disable subagents
SUBAGENTS_ENABLED=true
ASYNC_SUBAGENTS_ENABLED=true
REPO_AGENTS_DIR=".agents/agents"

# Per-subagent model configuration
EXPLORE_AGENT_MODEL=haiku
PLAN_AGENT_MODEL=inherit
GENERAL_AGENT_MODEL=inherit
VERIFICATION_AGENT_MODEL=inherit

# Async settings
VERIFICATION_TIMEOUT_MS=300000
VERIFICATION_POLL_INTERVAL_MS=5000

# Worker pool for concurrent async tasks
LANGGRAPH_N_JOBS_PER_WORKER=10
```

### Directory Structure

```
src/
├── subagents/
│   ├── registry.ts           # Built-in subagent definitions
│   ├── async.ts              # Async subagent configs
│   ├── agentsLoader.ts       # AGENTS.md loader
│   ├── toolFilter.ts         # Tool filtering utilities
│   ├── prompts/
│   │   ├── explore.ts        # Explore system prompt
│   │   ├── plan.ts           # Plan system prompt
│   │   └── general.ts        # General-Purpose system prompt
│   └── verification/
│       ├── graph.ts          # Verification LangGraph
│       └── prompt.ts         # Verification system prompt
├── harness/
│   └── deepagents.ts         # Modified to load subagents
└── tools/
    └── index.ts              # Existing tools

.agents/agents/               # Repo-specific agents (git-tracked)
├── custom-security.md
└── database-migration.md
```

## Error Handling

### Subagent Invocation Errors

- Wrap subagent calls in error-handling middleware
- Return helpful error messages to main agent
- Log errors with context
- Never crash main agent due to subagent failure

### AGENTS.md Parsing Errors

- Log and skip malformed files
- Require `name`, `description`, and system prompt
- Validate YAML frontmatter structure
- Provide clear error messages for missing fields

### Async Task Timeouts

- Configurable timeout per task type
- Graceful degradation to `VERDICT: PARTIAL`
- Preserve partial results for user review
- Log timeout events

### Tool Name Conflicts

- Warn when repo agent overrides built-in
- Allow explicit override by design
- Log all conflicts at startup
- Use last-wins strategy

## Implementation Phases

### Phase 1: Foundation
- Create subagent directory structure
- Implement synchronous subagents (Explore, Plan, General-Purpose)
- Integrate into existing agent creation
- Feature flag: `SUBAGENTS_ENABLED=false` (default)

### Phase 2: AGENTS.md Support
- Implement AGENTS.md loader
- Support `.agents/agents/` directory
- Merge with built-in agents
- Add documentation and examples

### Phase 3: Async Verification
- Upgrade deepagents to v1.9.0+
- Create verification graph
- Register in langgraph.json
- Configure async subagents
- Feature flag: `ASYNC_SUBAGENTS_ENABLED=false` (default)

### Phase 4: Integration & Polish
- Update main agent system prompt
- Add telemetry and monitoring
- Update CLAUDE.md documentation

## Success Criteria

1. Main agent successfully delegates to all 4 built-in subagents
2. AGENTS.md files are parsed and loaded correctly
3. Async verification runs non-blocking and returns results
4. Token usage reduced by 30%+ for exploration-heavy tasks
5. No regression in existing functionality when disabled

## References

- DeepAgents Subagents: https://docs.langchain.com/oss/javascript/deepagents/subagents
- DeepAgents Async Subagents: https://docs.langchain.com/oss/javascript/deepagents/async-subagents
- Claude Code Agents: `.claude/agents/` directory specifications
