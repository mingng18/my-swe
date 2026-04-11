# Blueprint State Machine Design

**Date:** 2026-04-11
**Status:** Design Approved
**Implementation Phases:** TBD

## Overview

Restructure the blueprint system to follow Stripe's minions pattern: blueprints define **state machine workflows** that intermix deterministic nodes and agentic nodes. Each blueprint compiles to a LangGraph StateGraph at runtime.

**Inspiration:** [Stripe Minions](https://stripe.com/blog/minions)

## Current State

The current blueprint system (`src/blueprints/blueprint.ts`) configures:
- Verification requirements (`requireTests`, `requireLint`, `maxFixIterations`)
- PR settings (`autoCreate`, `titleTemplate`)
- Prompt customization (`prepend`, `append`, `emphasizeQuality`)

This is insufficient because it doesn't define **workflow structure** or **subagent/tool configuration**.

## Proposed Design

### Core Concept

A **blueprint** is a state machine that:
1. Defines states (agent, deterministic, or terminal)
2. Specifies transitions between states (simple or conditional)
3. Configures inline subagents with model fallbacks and tool allowlists
4. References deterministic actions by name

### Blueprint Structure

```yaml
id: "bug-fix"
name: "Bug Fix"
description: "For fixing bugs and errors"
triggerKeywords: ["fix", "bug", "error"]
priority: 100
initialState: "explore"

states:
  explore:
    type: agent
    config:
      models: ["haiku"]
      tools: ["code_search", "semantic_search", "read"]
      systemPrompt: "Find the root cause..."
    next: ["plan"]

  lint:
    type: deterministic
    action: run_linters
    on:
      pass: ["test"]
      fail: ["fix_lint"]

  done:
    type: terminal
```

## Type Definitions

```typescript
interface Blueprint {
  id: string;
  name: string;
  description: string;
  triggerKeywords: string[];
  priority: number;
  states: Record<string, State>;
  initialState: string;
}

type State = AgentState | DeterministicState | TerminalState;

interface AgentState {
  type: "agent";
  config: AgentConfig;
  next: StateTransition;
}

interface DeterministicState {
  type: "deterministic";
  action: string;
  on?: ConditionalTransition;
}

interface TerminalState {
  type: "terminal";
}

interface AgentConfig {
  name?: string;
  models: string[];  // Fallback array
  tools: string[];   // Allowlist only (no disallowedTools)
  systemPrompt?: string;
}

type StateTransition = string[];

interface ConditionalTransition {
  pass?: string[];
  fail?: string[];
}
```

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Blueprint System                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Blueprint    │───▶│ Blueprint    │───▶│   LangGraph  │  │
│  │   (YAML)     │    │  Compiler    │    │  (Executable)│  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         ▲                                       │           │
│         │                                       ▼           │
│  ┌──────────────┐                      ┌──────────────┐   │
│  │  Blueprint   │                      │    State     │   │
│  │    Loader    │                      │   Executor   │   │
│  │  (Files)     │                      │ (LangGraph)  │   │
│  └──────────────┘                      └──────────────┘   │
│                                                  │           │
│                                                  ▼           │
│                                         ┌──────────────┐    │
│                                         │  Deterministic│   │
│                                         │  Action      │    │
│                                         │  Registry    │    │
│                                         └──────────────┘    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Components

1. **Blueprint Loader** (`src/blueprints/loader.ts`)
   - Loads YAML files from `.blueprints/` directory
   - Validates against JSON schema
   - Returns `Blueprint[]`
   - **TODO:** Future DB integration

2. **Blueprint Compiler** (`src/blueprints/compiler.ts`)
   - Converts `Blueprint` → LangGraph `StateGraph`
   - Registers nodes (agent or deterministic)
   - Adds edges based on transitions
   - Handles conditional edges for deterministic results

3. **Deterministic Action Registry** (`src/blueprints/actions.ts`)
   - Registers named actions (`run_linters`, `run_tests`, etc.)
   - Maps action names to executable functions
   - Returns `ActionResult { success, output, error }`

4. **Blueprint Selection** (`src/blueprints/selection.ts`)
   - Keyword-based matching (moved from current `blueprint.ts`)
   - Priority-based ordering
   - Returns `BlueprintSelection { blueprint, confidence, matchedKeywords }`

## Deterministic Actions

Built-in actions registered at startup:

```typescript
interface DeterministicAction {
  name: string;
  description: string;
  execute: (state: BlueprintState) => ActionResult;
}

interface ActionResult {
  success: boolean;
  output?: string;
  error?: string;
}
```

**Built-in actions:**
- `run_linters` - Execute `LINTER_COMMAND` env var
- `run_tests` - Run test suite
- `run_typecheck` - TypeScript type checking
- `create_pr` - Create pull request

Custom actions can be registered via `actionRegistry.register(action)`.

## Blueprint Compiler

The compiler converts blueprints to LangGraph StateGraphs:

```typescript
class BlueprintCompiler {
  compile(blueprint: Blueprint): StateGraph<BlueprintState> {
    const graph = new StateGraph({ channels: blueprintStateChannels });

    // Register all states as nodes
    for (const [stateId, state] of Object.entries(blueprint.states)) {
      graph.addNode(stateId, this.createNode(state));
    }

    // Add edges based on transitions
    this.addEdges(graph, blueprint);

    // Set entry point
    graph.setEntryPoint(blueprint.initialState);

    return graph.compile();
  }
}
```

**Node types:**
- **Agent node**: Creates inline subagent with config, invokes with input
- **Deterministic node**: Executes action from registry, returns result
- **Terminal node**: Ends execution

**Edge types:**
- **Simple edge**: Direct transition to next state
- **Conditional edge**: Routes to `pass` or `fail` states based on `ActionResult.success`

## Execution Flow

```typescript
// Select blueprint by task
const selection = selectBlueprint("fix the login bug");

// Compile to LangGraph
const graph = compiler.compile(selection.blueprint);

// Execute
const result = await graph.invoke({
  input: "fix the login bug",
  currentState: selection.blueprint.initialState,
});
```

## Directory Structure

```
src/blueprints/
├── types.ts              # Blueprint type definitions
├── loader.ts             # Load blueprints from YAML files
├── compiler.ts           # Compile blueprint → LangGraph
├── selection.ts          # Select blueprint by task keywords
├── actions.ts            # Deterministic action registry
├── index.ts              # Public exports
├── __tests__/
│   ├── compiler.test.ts
│   ├── loader.test.ts
│   └── integration.test.ts
└── schemas/
    └── blueprint-schema.json  # JSON schema for validation

.blueprints/              # Blueprint definitions (YAML)
├── bug-fix.yaml
├── feature.yaml
├── refactor.yaml
├── test.yaml
├── docs.yaml
└── chore.yaml
```

## Blueprint File Format

Blueprints are stored as YAML in `.blueprints/` directory.

**Example: `.blueprints/bug-fix.yaml`**

```yaml
id: "bug-fix"
name: "Bug Fix"
description: "For fixing bugs and errors"
triggerKeywords: ["fix", "bug", "error", "broken", "not working", "issue"]
priority: 100
initialState: "explore"

states:
  explore:
    type: agent
    config:
      models: ["haiku"]
      tools: ["code_search", "semantic_search", "read"]
      systemPrompt: |
        You are a codebase explorer. Find the root cause of the bug:
        - Search for relevant files
        - Read the error context
        - Identify the problematic code
    next: ["plan"]

  plan:
    type: agent
    config:
      models: ["claude-sonnet-4-6", "haiku"]
      tools: ["read", "grep"]
      systemPrompt: |
        Plan the bug fix:
        - Analyze the root cause
        - Design a minimal fix
        - List files that will change
    next: ["implement"]

  implement:
    type: agent
    config:
      models: ["claude-sonnet-4-6", "sonnet"]
      tools: ["edit", "write", "read", "code_search"]
      systemPrompt: |
        Implement the bug fix:
        - Make minimal changes to fix the issue
        - Don't refactor unrelated code
        - Focus on the specific bug
    next: ["lint"]

  lint:
    type: deterministic
    action: run_linters
    on:
      pass: ["test"]
      fail: ["fix_lint"]

  fix_lint:
    type: agent
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix the lint errors. Don't change behavior."
    next: ["lint"]

  test:
    type: deterministic
    action: run_tests
    on:
      pass: ["create_pr"]
      fail: ["fix_test"]

  fix_test:
    type: agent
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix the failing tests. Ensure all tests pass."
    next: ["test"]

  create_pr:
    type: deterministic
    action: create_pr
    next: ["done"]

  done:
    type: terminal
```

## State Management

```typescript
interface BlueprintState {
  input: string;
  currentState: string;
  lastResult?: ActionResult;
  error?: string;
  // ... other fields as needed
}
```

The state is passed between nodes and updated with:
- `currentState`: Tracks current position in workflow
- `lastResult`: Contains output from previous node (used for conditional transitions)
- `error`: Captures any errors for graceful handling

## Error Handling

```typescript
class BlueprintValidationError extends Error { ... }
class ActionExecutionError extends Error { ... }
class StateTransitionError extends Error { ... }
class BlueprintCompilerError extends Error { ... }
```

**Error handling strategies:**
1. **Validation phase** - Catch blueprint schema errors at load time
2. **Compilation phase** - Catch missing actions, invalid transitions
3. **Execution phase** - Graceful degradation, return error to state

## Integration with Existing Code

**Before:**
```typescript
await agentHarness.invoke(task, { threadId });
```

**After:**
```typescript
await executeWithBlueprint(task, threadId);
```

The blueprint system becomes the **primary execution path**, wrapping the agent harness.

## Removed from Current Implementation

- `VerificationRequirements` interface (handled by blueprint states)
- `PRRequirements` interface (handled by deterministic actions)
- `PromptCustomization` interface (handled by inline agent config)
- `buildInputWithBlueprint()` function (replaced by inline config)
- `blueprintToInvokeConfig()` function (no longer needed)

## Kept from Current Implementation

- Keyword-based blueprint selection (moved to `selection.ts`)
- Priority-based ordering
- Default blueprints (now as YAML files)

## Future Enhancements (TODO)

- **DB integration:** Load blueprints from database instead of files
- **Blueprint editor:** Web UI for creating/editing blueprints
- **Versioning:** Track blueprint versions and rollback capability
- **Analytics:** Track blueprint success rates and optimize
- **Conditional transitions:** Support more complex conditions (not just pass/fail)
- **Parallel states:** Execute multiple states concurrently
- **Sub-blueprints:** Compose blueprints from reusable sub-workflows

## Success Criteria

1. Blueprints can be defined as YAML and loaded at runtime
2. Blueprints compile to executable LangGraph StateGraphs
3. Agent states configure models with fallback and tool allowlists
4. Deterministic states execute registered actions
5. Conditional transitions route based on action results
6. Default blueprints (bug-fix, feature, etc.) work end-to-end
7. Existing functionality is preserved (no regression)
