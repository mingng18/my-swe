# Blueprint System Documentation

The Bullhorse blueprint system is a state machine workflow framework inspired by [Stripe Minions](https://stripe.com/blog/minions). Blueprints define workflows that intermix agent nodes (LLM-powered reasoning) and deterministic nodes (shell commands, validation, etc.) to create robust, verifiable development pipelines.

## Table of Contents

1. [Overview](#1-overview) - System architecture and design philosophy
2. [Core Concepts](#2-core-concepts) - Blueprint structure and types
3. [YAML Format Reference](#3-yaml-format-reference) - Complete field documentation
4. [Loading Blueprints](#4-loading-blueprints) - Loading and validation
5. [Selection Logic](#5-selection-logic) - Automatic blueprint selection
6. [Compilation](#6-compilation) - Converting blueprints to LangGraph
7. [Built-in Actions](#7-built-in-actions) - Deterministic node implementations
8. [Custom Actions](#8-custom-actions) - Creating and registering actions
9. [Creating Blueprints](#9-creating-blueprints) - Writing custom blueprints
10. [Default Blueprints](#10-default-blueprints) - Included blueprint examples
11. [API Reference](#11-api-reference) - Complete API documentation

---

## 1. Overview

### What are Blueprints?

Blueprints are YAML-defined state machines that specify:
- **States**: Steps in the workflow (agent tasks, tests, linters, etc.)
- **Transitions**: How to move between states based on outcomes
- **Configuration**: Models, tools, and prompts for each state
- **Triggers**: Keywords that automatically select the blueprint

### Design Philosophy

| Principle | Description |
|-----------|-------------|
| **Separation of Concerns** | Agent nodes handle reasoning, deterministic nodes handle verification |
| **Fail-Safe by Default** | Every verification state has a fix/retry path |
| **Model Optimization** | Use cheaper models for simple tasks, premium for complex reasoning |
| **Declarative Workflows** | Define what should happen, not how to implement it |
| **Composability** | Blueprints can reference custom actions and share state |

### Architecture

```
┌─────────────────┐
│   Task Input    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ Blueprint       │────►│ Blueprint        │
│ Selection       │     │ Loader           │
└─────────────────┘     └──────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐     ┌──────────────────┐
│ Selected        │────►│ LangGraph        │
│ Blueprint       │     │ Compiler         │
└─────────────────┘     └──────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ Executable       │
                        │ StateGraph       │
                        └──────────────────┘
```

---

## 2. Core Concepts

### Blueprint Structure

A blueprint is a YAML file with the following structure:

```yaml
id: "blueprint-id"           # Unique identifier
name: "Display Name"         # Human-readable name
description: "What it does"  # Description
triggerKeywords: ["fix"]     # Auto-trigger keywords
priority: 100                # Higher = selected first
initialState: "start"        # Entry point state

states:
  state_name:                # State identifier
    type: "agent"            # State type
    config:                  # Agent-specific config
      models: ["sonnet"]     # Models to use (fallback array)
      tools: ["read"]        # Available tools
      systemPrompt: "..."    # Agent instructions
    next: ["next_state"]     # Next state(s)
    on:                      # Conditional transitions (deterministic only)
      pass: ["success_state"]
      fail: ["retry_state"]
```

### State Types

| Type | Description | Use Case | Example |
|------|-------------|----------|---------|
| **agent** | LLM-powered reasoning node | Code generation, analysis, planning | `type: "agent"` |
| **deterministic** | Shell command/action execution | Tests, linters, Git operations | `type: "deterministic"` |
| **terminal** | End of workflow | Success/final state | `type: "terminal"` |

### Type System

```typescript
// Blueprint definition
interface Blueprint {
  id: string;
  name: string;
  description: string;
  triggerKeywords: string[];
  priority: number;
  initialState: string;
  states: Record<string, State>;
}

// State types
type State = AgentState | DeterministicState | TerminalState;

interface AgentState {
  type: "agent";
  config: AgentConfig;
  next: StateTransition;  // Array of next state IDs
}

interface DeterministicState {
  type: "deterministic";
  action: string;         // Action name from registry
  on?: ConditionalTransition;  // Conditional transitions
  next?: StateTransition;      // Simple transition (fallback)
}

interface TerminalState {
  type: "terminal";
}

interface AgentConfig {
  name?: string;
  models: string[];       // Fallback chain (try first, then second)
  tools: string[];        // Tool allowlist
  systemPrompt?: string;  // Optional override prompt
}
```

### State Transitions

```typescript
// Simple transition (agent states)
type StateTransition = string[];

// Conditional transition (deterministic states)
interface ConditionalTransition {
  pass?: string[];  // States on success (exit code 0)
  fail?: string[];  // States on failure (non-zero exit code)
}
```

**Example:**

```yaml
# Agent state - simple transitions
implement:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["edit", "write"]
  next: ["verify", "review"]  # Agent chooses dynamically

# Deterministic state - conditional transitions
verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["deploy"]     # Tests pass → deploy
    fail: ["fix_tests"]  # Tests fail → fix
```

---

## 3. YAML Format Reference

This section provides a comprehensive reference for all fields and properties available in blueprint YAML files.

### Root-Level Properties

| Property | Type | Required | Description | Example |
|----------|------|----------|-------------|---------|
| `id` | `string` | Yes | Unique identifier for the blueprint. Must match pattern `^[a-z0-9-]+$` (lowercase letters, numbers, hyphens only). | `bug-fix` |
| `name` | `string` | Yes | Human-readable display name for the blueprint. | `Bug Fix Blueprint` |
| `description` | `string` | Yes | Detailed description of what the blueprint does and when to use it. | `Fixes bugs with verification loop` |
| `triggerKeywords` | `string[]` | Yes | Array of keywords that trigger automatic selection of this blueprint. Case-insensitive matching. | `["fix", "bug", "error"]` |
| `priority` | `number` | Yes | Selection priority (higher values selected first). Must be ≥ 0. | `100` |
| `initialState` | `string` | Yes | The ID of the starting state in the workflow. Must exist in the `states` object. | `explore` |
| `states` | `object` | Yes | Object defining all workflow states. Keys are state IDs, values are state configurations. | See below |

#### Root-Level Examples

```yaml
id: "bug-fix"
name: "Bug Fix Blueprint"
description: "Debugging workflow with automated verification"
triggerKeywords: ["fix", "bug", "error", "broken"]
priority: 100
initialState: "explore"
states:
  # ... state definitions
```

### State Types

Every state in the `states` object must have a `type` property. The following types are supported:

| Type | Value | Required Properties | Description |
|------|-------|---------------------|-------------|
| Agent | `"agent"` | `type`, `config`, `next` | LLM-powered reasoning node |
| Deterministic | `"deterministic"` | `type`, `action` | Shell command/action execution |
| Terminal | `"terminal"` | `type` | End of workflow |

### Agent State Configuration

An agent state uses LLM reasoning to perform tasks. It requires the following properties:

#### Agent State Properties

| Property | Type | Required | Description | Example |
|----------|------|----------|-------------|---------|
| `type` | `string` | Yes | Must be `"agent"` | `agent` |
| `config` | `object` | Yes | Agent configuration object | See below |
| `next` | `string[]` | Yes | Array of possible next state IDs. The agent dynamically chooses from these options. | `["verify", "review"]` |

#### Agent Config Properties

The `config` object configures the agent's behavior:

| Property | Type | Required | Description | Example |
|----------|------|----------|-------------|---------|
| `name` | `string` | No | Optional display name for this agent state. Defaults to state ID. | `planner` |
| `models` | `string[]` | Yes | Array of model identifiers to use, in priority order. The system tries each model in sequence until one succeeds. | `["sonnet", "haiku"]` |
| `tools` | `string[]` | Yes | Array of tool names that the agent is allowed to use. | `["read", "write", "edit"]` |
| `systemPrompt` | `string` | No | Custom system prompt for this agent state. Overrides default prompts. | `"You are a code reviewer..."` |

#### Model Identifiers

Available model identifiers:

| Model ID | Speed | Cost | Quality | Best Use Case |
|----------|-------|------|---------|---------------|
| `haiku` | Fast | Low | Good | Exploration, simple tasks, documentation |
| `sonnet` | Medium | Medium | High | Most code work, bug fixes, refactoring |
| `claude-sonnet-4-6` | Slower | Higher | Best | Planning, architecture, complex reasoning |

#### Tool Names

Available tools for agent states:

| Tool Name | Description |
|-----------|-------------|
| `read` | Read file contents |
| `write` | Write new files |
| `edit` | Edit existing files |
| `code_search` | Search code by pattern |
| `grep` | Search text in files |
| `semantic_search` | Search by meaning |
| `bash` | Execute shell commands |

#### Agent State Examples

**Basic Agent State:**

```yaml
implement:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit"]
  next: ["verify"]
```

**Agent State with Multiple Model Fallbacks:**

```yaml
analyze:
  type: "agent"
  config:
    name: "code_analyzer"
    models: ["claude-sonnet-4-6", "sonnet", "haiku"]
    tools: ["read", "grep", "code_search"]
    systemPrompt: "Analyze the code structure and identify issues."
  next: ["report"]
```

**Agent State with Dynamic Next State Selection:**

```yaml
assess:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "semantic_search"]
    systemPrompt: "Assess the problem and choose the appropriate solution path."
  next: ["simple_fix", "complex_refactor", "manual_review"]
  # Agent will choose from these three options based on the situation
```

### Deterministic State Configuration

A deterministic state executes a predefined action (shell command, validation, etc.) based on the result.

#### Deterministic State Properties

| Property | Type | Required | Description | Example |
|----------|------|----------|-------------|---------|
| `type` | `string` | Yes | Must be `"deterministic"` | `deterministic` |
| `action` | `string` | Yes | Name of the action to execute. Must be registered in the action registry. | `run_tests` |
| `on` | `object` | No | Conditional transitions based on action result | See below |
| `on.pass` | `string[]` | No | Next state IDs if action succeeds (exit code 0). Defaults to `["__end__"]` | `["deploy"]` |
| `on.fail` | `string[]` | No | Next state IDs if action fails (non-zero exit code). Defaults to `["__end__"]` | `["fix"]` |

#### Built-in Actions

| Action Name | Description | Environment Variables |
|-------------|-------------|----------------------|
| `run_linters` | Run configured linters | `LINTER_COMMAND` (default: `bunx tsc --noEmit`) |
| `run_tests` | Execute test suite | `TEST_COMMAND` (default: `bun test`) |
| `run_typecheck` | Run TypeScript type checking | (none) |
| `create_pr` | Create pull request | (none) |

#### Deterministic State Examples

**Basic Deterministic State:**

```yaml
verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["deploy"]
    fail: ["fix"]
```

**Deterministic State with Only Success Path:**

```yaml
lint:
  type: "deterministic"
  action: "run_linters"
  on:
    pass: ["test"]
    # fail defaults to ["__end__"]
```

**Deterministic State for Always-Passing Action:**

```yaml
notify:
  type: "deterministic"
  action: "create_pr"
  # create_pr always passes, so no 'on' needed
```

### Terminal State Configuration

A terminal state ends the workflow execution.

#### Terminal State Properties

| Property | Type | Required | Description | Example |
|----------|------|----------|-------------|---------|
| `type` | `string` | Yes | Must be `"terminal"` | `terminal` |

#### Terminal State Examples

```yaml
done:
  type: "terminal"

success:
  type: "terminal"

failed:
  type: "terminal"
```

### State Transitions

#### Agent State Transitions

Agent states use simple transitions where the agent dynamically chooses from multiple possible next states:

```yaml
agent_state:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write"]
  next: ["option_a", "option_b", "option_c"]
  # Agent uses LLM reasoning to choose which state to transition to
```

#### Deterministic State Transitions

Deterministic states use conditional transitions based on the action's exit code:

```yaml
check_result:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["deploy"]     # Exit code 0
    fail: ["fix_tests"]  # Non-zero exit code
```

**Transition Rules:**

| Condition | Transition |
|-----------|------------|
| Action succeeds (exit code 0) | Follow `on.pass` transitions |
| Action fails (non-zero exit code) | Follow `on.fail` transitions |
| No `on.pass` defined | Transition to `["__end__"]` on success |
| No `on.fail` defined | Transition to `["__end__"]` on failure |
| Both `on.pass` and `on.fail` undefined | Transition to `["__end__"]` (implicit terminal) |

### Complete Blueprint Example

```yaml
# Root-level properties
id: "bug-fix"
name: "Bug Fix Workflow"
description: "Fix bugs with automated testing and verification"
triggerKeywords: ["fix", "bug", "error"]
priority: 100
initialState: "explore"

# State definitions
states:
  # Agent state with single model
  explore:
    type: "agent"
    config:
      name: "code_explorer"
      models: ["haiku"]
      tools: ["read", "code_search", "grep"]
      systemPrompt: "Explore the codebase to understand the bug."
    next: ["plan"]

  # Agent state with model fallbacks
  plan:
    type: "agent"
    config:
      models: ["sonnet", "haiku"]
      tools: ["read", "write"]
    next: ["implement"]

  # Agent state with dynamic branching
  implement:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["write", "edit"]
    next: ["lint", "skip_verification"]

  # Deterministic state with both transitions
  lint:
    type: "deterministic"
    action: "run_linters"
    on:
      pass: ["test"]
      fail: ["fix_lint"]

  # Deterministic state with only pass transition
  test:
    type: "deterministic"
    action: "run_tests"
    on:
      pass: ["done"]
      fail: ["fix_test"]

  # Agent state for fixing issues
  fix_lint:
    type: "agent"
    config:
      models: ["haiku"]
      tools: ["edit"]
    next: ["lint"]

  # Terminal state
  done:
    type: "terminal"
```

### Validation Rules

The blueprint loader enforces the following validation rules:

#### Root-Level Validation

| Rule | Error Message |
|------|---------------|
| `id` must be present | `"id" is required` |
| `id` must match pattern `^[a-z0-9-]+$` | `"id" must contain only lowercase letters, numbers, and hyphens` |
| `name` must be present | `"name" is required` |
| `description` must be present | `"description" is required` |
| `triggerKeywords` must be present and non-empty | `"triggerKeywords" is required` |
| `priority` must be present and ≥ 0 | `"priority" is required` |
| `initialState` must be present | `"initialState" is required` |
| `initialState` must exist in `states` | `Initial state "X" not found in states` |
| `states` must be present and non-empty | `"states" is required` |

#### State-Level Validation

| Rule | Error Message |
|------|---------------|
| Every state must have `type` | `"type" is required for state "X"` |
| `type` must be `"agent"`, `"deterministic"`, or `"terminal"` | `Invalid state type "X"` |
| Agent states must have `config` | `"config" is required for agent state "X"` |
| Agent states must have `next` | `"next" is required for agent state "X"` |
| Agent `config` must have `models` | `"models" is required for agent config` |
| Agent `config.models` must be non-empty | `Agent "models" array cannot be empty` |
| Agent `config` must have `tools` | `"tools" is required for agent config` |
| Deterministic states must have `action` | `"action" is required for deterministic state "X"` |
| Terminal states cannot have other properties | `Terminal state "X" cannot have additional properties` |

### Common Patterns

#### Pattern 1: Verification Loop

```yaml
states:
  implement:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["write", "edit"]
    next: ["verify"]

  verify:
    type: "deterministic"
    action: "run_tests"
    on:
      pass: ["done"]
      fail: ["fix"]

  fix:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit"]
    next: ["verify"]

  done:
    type: "terminal"
```

#### Pattern 2: Multi-Model Pipeline

```yaml
states:
  explore:
    type: "agent"
    config:
      models: ["haiku"]  # Fast exploration
      tools: ["read", "grep"]
    next: ["analyze"]

  analyze:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6"]  # Deep analysis
      tools: ["read", "semantic_search"]
    next: ["implement"]

  implement:
    type: "agent"
    config:
      models: ["sonnet", "haiku"]  # Fallback to cheaper model
      tools: ["write", "edit"]
    next: ["done"]
```

#### Pattern 3: Dynamic Branching

```yaml
states:
  assess:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["read", "semantic_search"]
      systemPrompt: "Assess the complexity and choose the appropriate approach."
    next: ["simple_fix", "complex_refactor"]

  simple_fix:
    type: "agent"
    config:
      models: ["haiku"]
      tools: ["edit"]
    next: ["verify"]

  complex_refactor:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6"]
      tools: ["write", "read"]
    next: ["verify"]
```

### Type Reference

This is the complete TypeScript type definition for blueprints:

```typescript
interface Blueprint {
  /** Unique identifier (lowercase, numbers, hyphens only) */
  id: string;
  
  /** Human-readable display name */
  name: string;
  
  /** Detailed description */
  description: string;
  
  /** Keywords that trigger selection */
  triggerKeywords: string[];
  
  /** Selection priority (higher = selected first) */
  priority: number;
  
  /** Starting state ID */
  initialState: string;
  
  /** All workflow states */
  states: Record<string, State>;
}

type State = AgentState | DeterministicState | TerminalState;

interface AgentState {
  type: "agent";
  config: AgentConfig;
  next: string[];  // Agent chooses from these options
}

interface AgentConfig {
  /** Optional display name */
  name?: string;
  
  /** Models to try in order (fallback chain) */
  models: string[];
  
  /** Allowed tools */
  tools: string[];
  
  /** Optional system prompt override */
  systemPrompt?: string;
}

interface DeterministicState {
  type: "deterministic";
  action: string;  // Action name from registry
  on?: ConditionalTransition;
}

interface ConditionalTransition {
  /** Next states on success (exit code 0) */
  pass?: string[];
  
  /** Next states on failure (non-zero exit code) */
  fail?: string[];
}

interface TerminalState {
  type: "terminal";
}
```

---

## 4. Loading Blueprints

### BlueprintLoader

The `BlueprintLoader` class loads and validates blueprint YAML files.

```typescript
import { BlueprintLoader, BlueprintValidationError } from './blueprints';

// Create loader with options
const loader = new BlueprintLoader({
  blueprintsDir: '.blueprints',  // Default: '.blueprints'
  validate: true,                // Default: true
});

// Load all blueprints from directory
const blueprints = await loader.loadAll();
// Returns: Blueprint[] (sorted by priority, descending)

// Parse single blueprint from string
const blueprint = loader.parse(yamlString, '/path/to/file.yaml');

// Validation errors throw BlueprintValidationError
try {
  await loader.loadAll();
} catch (error) {
  if (error instanceof BlueprintValidationError) {
    console.error(`Blueprint '${error.blueprintId}' has errors:`);
    error.errors.forEach(err => console.error(`  - ${err}`));
  }
}
```

### Validation Rules

The loader validates:

| Field | Rule |
|-------|------|
| `id` | Required, unique string |
| `name` | Required, non-empty string |
| `description` | Required, non-empty string |
| `triggerKeywords` | Required, non-empty array |
| `priority` | Required, number |
| `initialState` | Required, must exist in states |
| `states` | Required, non-empty object |
| `states[*].type` | Required, must be "agent", "deterministic", or "terminal" |
| `agent.config` | Required for agent states |
| `agent.next` | Required for agent states |
| `deterministic.action` | Required for deterministic states |

### File Discovery

```bash
.blueprints/
├── bug-fix.yaml       # Loaded
├── feature.yaml       # Loaded
├── custom/
│   └── my-blueprint.yaml  # NOT loaded (subdirectories not scanned)
└── README.md          # Ignored (non-YAML)
```

**Note:** Only top-level `.yaml` and `.yml` files are loaded. Subdirectories are not scanned.

---

## 5. Selection Logic

### selectBlueprint

The `selectBlueprint` function automatically selects the appropriate blueprint based on task keywords.

```typescript
import { selectBlueprint } from './blueprints';

const task = "Fix the login bug";
const selection = selectBlueprint(task, blueprints);

console.log(selection);
// {
//   blueprint: Blueprint,
//   confidence: 0.5,        // Matched keywords / total keywords
//   matchedKeywords: ["fix", "bug"]
// }
```

### Selection Algorithm

1. **Priority-based sorting**: Blueprints sorted by `priority` (descending)
2. **Keyword matching**: Check if any trigger keyword matches task (case-insensitive)
3. **First match wins**: Return first blueprint with matching keyword
4. **Default fallback**: If no match, return blueprint with `id: "default"`

```typescript
// Internal algorithm
for (const blueprint of blueprints.sort((a, b) => b.priority - a.priority)) {
  const pattern = new RegExp(
    blueprint.triggerKeywords.map(k => k.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')).join('|'),
    'i'
  );

  if (pattern.test(task)) {
    const matchedKeywords = blueprint.triggerKeywords.filter(k =>
      new RegExp(k.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&'), 'i').test(task)
    );

    return {
      blueprint,
      confidence: matchedKeywords.length / blueprint.triggerKeywords.length,
      matchedKeywords,
    };
  }
}

// Fallback to default
return { blueprint: defaultBlueprint, confidence: 0, matchedKeywords: [] };
```

### Utility Functions

```typescript
import { getBlueprintById, listBlueprints } from './blueprints';

// Get blueprint by ID
const blueprint = getBlueprintById('bug-fix', blueprints);
// Returns: Blueprint | undefined

// List all blueprints (sorted by priority)
const all = listBlueprints(blueprints);
// Returns: Blueprint[]
```

### Selection Example

```typescript
const blueprints = [
  { id: 'bug-fix', triggerKeywords: ['fix', 'bug'], priority: 100 },
  { id: 'feature', triggerKeywords: ['implement', 'add'], priority: 90 },
  { id: 'default', triggerKeywords: [], priority: 0 }
];

// Task: "Fix the authentication bug"
const selection = selectBlueprint("Fix the authentication bug", blueprints);
// → { blueprint: bug-fix, confidence: 1.0, matchedKeywords: ['fix', 'bug'] }

// Task: "Add user registration"
const selection = selectBlueprint("Add user registration", blueprints);
// → { blueprint: feature, confidence: 0.5, matchedKeywords: ['add'] }

// Task: "Update the README"
const selection = selectBlueprint("Update the README", blueprints);
// → { blueprint: default, confidence: 0.0, matchedKeywords: [] }
```

---

## 6. Compilation

### BlueprintCompiler

The `BlueprintCompiler` converts blueprint definitions into executable LangGraph StateGraph instances.

```typescript
import { BlueprintCompiler, ActionRegistry } from './blueprints';
import { loadBlueprints } from './blueprints';

// Load blueprints
const blueprints = await loadBlueprints();

// Create action registry with built-in actions
const actionRegistry = new ActionRegistry();
registerBuiltinActions();  // Or register custom actions

// Compile blueprint to LangGraph
const compiler = new BlueprintCompiler(actionRegistry);
const graph = compiler.compile(blueprints[0]);

// Execute the graph
const result = await graph.invoke({
  input: "Fix the login bug",
  currentState: "explore",
  lastResult: undefined,
  error: undefined,
});
```

### Compilation Process

1. **Create StateGraph**: Initialize with `BlueprintStateAnnotation`
2. **Add nodes**: Register all states as graph nodes
3. **Add edges**: Wire up state transitions
4. **Set entry point**: Configure initial state
5. **Compile**: Produce executable LangGraph

### Blueprint State

The state passed between blueprint nodes:

```typescript
interface BlueprintState {
  /** Original task input */
  input: string;

  /** Current state ID */
  currentState: string;

  /** Last action result (for conditional transitions) */
  lastResult?: ActionResult;

  /** Error message if something went wrong */
  error?: string;
}

interface ActionResult {
  success: boolean;
  output?: string;
  error?: string;
}
```

### Node Execution

```typescript
// Agent node execution
private async executeAgentNode(
  state: AgentState,
  graphState: BlueprintState
): Promise<BlueprintState> {
  // Agent would execute here
  // Currently returns mock success
  return {
    ...graphState,
    currentState: state.next[0] || "__end__",
    lastResult: {
      success: true,
      output: `Agent '${state.config.name || 'unnamed'}' executed`,
    },
  };
}

// Deterministic node execution
private async executeDeterministicNode(
  state: DeterministicState,
  graphState: BlueprintState
): Promise<BlueprintState> {
  const action = this.actionRegistry.get(state.action);
  if (!action) {
    throw new BlueprintCompilerError("unknown", `Action not found: ${state.action}`);
  }

  const result = await action.execute(graphState);
  return { ...graphState, lastResult: result };
}
```

### Edge Configuration

```typescript
// Agent state: simple edges
graph.addEdge(stateId, next_state);

// Deterministic state: conditional edges
graph.addConditionalEdges(
  stateId,
  (s: BlueprintState) => s.lastResult?.success ? "pass" : "fail",
  {
    pass: state.on.pass || ["__end__"],
    fail: state.on.fail || ["__end__"],
  }
);
```

---

## 7. Built-in Actions

### Action Registry

The `ActionRegistry` manages deterministic actions that can be used in blueprint states.

```typescript
import { actionRegistry, registerBuiltinActions } from './blueprints';

// Register all built-in actions
registerBuiltinActions();

// List all registered actions
const actions = actionRegistry.list();
// Returns: DeterministicAction[]

// Check if action exists
if (actionRegistry.has('run_linters')) {
  // Action is available
}

// Get action by name
const action = actionRegistry.get('run_tests');
// Returns: DeterministicAction | undefined
```

### Built-in Actions

| Action Name | Description | Environment Variables | Exit Codes |
|-------------|-------------|----------------------|------------|
| `run_linters` | Run configured linters | `LINTER_COMMAND` (default: `bunx tsc --noEmit`) | 0 = pass, non-zero = fail |
| `run_tests` | Execute test suite | `TEST_COMMAND` (default: `bun test`) | 0 = pass, non-zero = fail |
| `run_typecheck` | Run TypeScript type checking | (none) | 0 = pass, non-zero = fail |
| `create_pr` | Create pull request | (none) | Always passes (not yet implemented) |

### Action Implementation

```typescript
interface DeterministicAction {
  name: string;
  description: string;
  execute: (state: BlueprintState) => Promise<ActionResult>;
}

interface ActionResult {
  success: boolean;
  output?: string;
  error?: string;
}
```

### Built-in Action Details

#### run_linters

```typescript
const runLintersAction: DeterministicAction = {
  name: "run_linters",
  description: "Run configured linters",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    const linterCommand = process.env.LINTER_COMMAND || "bunx tsc --noEmit";
    try {
      const { command, args } = parseCommandArgs(linterCommand);
      const { stdout, stderr } = await execFileAsync(command, args);
      return { success: true, output: stdout || "Linters passed" };
    } catch (error) {
      return {
        success: false,
        error: error.stderr || error.message || "Linters failed",
      };
    }
  },
};
```

#### run_tests

```typescript
const runTestsAction: DeterministicAction = {
  name: "run_tests",
  description: "Run test suite",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    const testCommand = process.env.TEST_COMMAND || "bun test";
    try {
      const { command, args } = parseCommandArgs(testCommand);
      const { stdout, stderr } = await execFileAsync(command, args);
      return { success: true, output: stdout || "Tests passed" };
    } catch (error) {
      return {
        success: false,
        error: error.stderr || error.message || "Tests failed",
      };
    }
  },
};
```

#### run_typecheck

```typescript
const runTypecheckAction: DeterministicAction = {
  name: "run_typecheck",
  description: "Run TypeScript type checking",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    try {
      const { command, args } = parseCommandArgs("bunx tsc --noEmit");
      const { stdout, stderr } = await execFileAsync(command, args);
      return { success: true, output: "Type check passed" };
    } catch (error) {
      return {
        success: false,
        error: error.stderr || error.message || "Type check failed",
      };
    }
  },
};
```

#### create_pr

```typescript
const createPrAction: DeterministicAction = {
  name: "create_pr",
  description: "Create pull request",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    return { success: false, error: "Not yet implemented" };
  },
};
```

### Command Parsing

Built-in actions use `parseCommandArgs` to handle quoted arguments:

```typescript
parseCommandArgs('bunx tsc --noEmit');
// → { command: 'bunx', args: ['tsc', '--noEmit'] }

parseCommandArgs('git commit -m "Fix the bug"');
// → { command: 'git', args: ['commit', '-m', 'Fix the bug'] }

parseCommandArgs('echo "Hello \'world\'"');
// → { command: 'echo', args: ["Hello 'world'"] }
```

---

## 8. Custom Actions

### Creating Custom Actions

```typescript
import { ActionRegistry } from './blueprints';
import type { DeterministicAction, ActionResult, BlueprintState } from './blueprints';

// Define custom action
const formatCodeAction: DeterministicAction = {
  name: "format_code",
  description: "Format code with prettier",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);

      const { stdout, stderr } = await execFileAsync('npx', ['prettier', '--write', '.']);
      return { success: true, output: stdout || "Code formatted" };
    } catch (error) {
      return {
        success: false,
        error: error.stderr || error.message || "Formatting failed",
      };
    }
  },
};

// Register custom action
const registry = new ActionRegistry();
registry.register(formatCodeAction);

// Use in blueprint
/*
states:
  format:
    type: "deterministic"
    action: "format_code"
    on:
      pass: ["commit"]
      fail: ["fix_format"]
*/
```

### Accessing State in Actions

```typescript
const customAction: DeterministicAction = {
  name: "custom_action",
  description: "Action that uses state",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    // Access original task input
    console.log('Task:', state.input);

    // Access current state
    console.log('Current state:', state.currentState);

    // Access last result
    if (state.lastResult) {
      console.log('Last result:', state.lastResult.output);
    }

    // Access error if present
    if (state.error) {
      console.error('Error:', state.error);
    }

    return { success: true, output: "Action completed" };
  },
};
```

### Async Actions

Actions can perform async operations:

```typescript
const deployAction: DeterministicAction = {
  name: "deploy",
  description: "Deploy to production",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    // Fetch deployment status from API
    const response = await fetch('https://api.example.com/deploy', {
      method: 'POST',
      body: JSON.stringify({ task: state.input }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Deployment failed: ${response.statusText}`,
      };
    }

    const result = await response.json();
    return { success: true, output: `Deployed: ${result.url}` };
  },
};
```

### Action Error Handling

```typescript
const safeAction: DeterministicAction = {
  name: "safe_action",
  description: "Action with comprehensive error handling",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    try {
      // Validate state
      if (!state.input) {
        return {
          success: false,
          error: "No input provided",
        };
      }

      // Execute action
      const result = await doSomething(state.input);

      // Return success
      return {
        success: true,
        output: result,
      };
    } catch (error) {
      // Return failure with error details
      return {
        success: false,
        error: error.message || "Action failed",
      };
    }
  },
};
```

---

## 9. Creating Blueprints

### Minimal Blueprint Template

```yaml
id: "my-blueprint"
name: "My Custom Blueprint"
description: "What this blueprint does"
triggerKeywords: ["keyword1", "keyword2"]
priority: 60
initialState: "start"

states:
  start:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["read", "write", "edit"]
      systemPrompt: "Your instructions here"
    next: ["done"]

  done:
    type: "terminal"
```

### Blueprint File Location

```
.blueprints/
├── bug-fix.yaml      # Built-in blueprint
├── feature.yaml      # Built-in blueprint
└── my-blueprint.yaml # Custom blueprint (loaded automatically)
```

### State Design Patterns

#### 1. Simple Agent State

```yaml
do_work:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit"]
    systemPrompt: "Perform the requested task."
  next: ["done"]
```

#### 2. Verification Loop

```yaml
verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["done"]
    fail: ["fix"]

fix:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["edit", "write"]
    systemPrompt: "Fix the failing tests."
  next: ["verify"]
```

#### 3. Multi-Agent Pipeline

```yaml
plan:
  type: "agent"
  config:
    models: ["claude-sonnet-4-6"]
    tools: ["read", "grep"]
    systemPrompt: "Create a detailed plan."
  next: ["implement"]

implement:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["write", "edit"]
    systemPrompt: "Implement the plan."
  next: ["verify"]
```

#### 4. Conditional Branching

```yaml
assess:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
    systemPrompt: "Assess the situation and determine the approach."
  next: ["simple_fix", "complex_refactor"]

simple_fix:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["edit"]
    systemPrompt: "Apply the simple fix."
  next: ["done"]

complex_refactor:
  type: "agent"
  config:
    models: ["claude-sonnet-4-6"]
    tools: ["write", "read"]
    systemPrompt: "Perform the complex refactoring."
  next: ["verify"]
```

### Model Selection Strategy

| Model | Speed | Cost | Quality | Best For |
|-------|-------|------|---------|----------|
| `haiku` | Fast | Low | Good | Exploration, simple tasks, documentation |
| `sonnet` | Medium | Medium | High | Most code work, bug fixes, refactoring |
| `claude-sonnet-4-6` | Slower | Higher | Best | Planning, architecture, complex tasks |

**Example:**

```yaml
# Fast exploration with Haiku
explore:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["code_search", "read"]
    systemPrompt: "Find the relevant code."
  next: ["plan"]

# High-quality planning with Claude Sonnet
plan:
  type: "agent"
  config:
    models: ["claude-sonnet-4-6"]
    tools: ["read", "grep"]
    systemPrompt: "Create a detailed implementation plan."
  next: ["implement"]

# Implementation with Sonnet (fallback to Haiku)
implement:
  type: "agent"
  config:
    models: ["sonnet", "haiku"]  # Try sonnet, fall back to haiku
    tools: ["write", "edit"]
    systemPrompt: "Implement the plan."
  next: ["done"]
```

### Tool Selection

Available tools:

| Tool | Description |
|------|-------------|
| `read` | Read file contents |
| `write` | Write new files |
| `edit` | Edit existing files |
| `code_search` | Search code by pattern |
| `grep` | Search text in files |
| `semantic_search` | Search by meaning |
| `bash` | Execute shell commands |

**Example:**

```yaml
# Read-only exploration
explore:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "code_search", "grep"]
    systemPrompt: "Explore the codebase."
  next: ["implement"]

# Full write access
implement:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit", "bash"]
    systemPrompt: "Implement the changes."
  next: ["done"]
```

### Priority Configuration

Higher priority blueprints are selected first. Recommended priorities:

| Blueprint Type | Priority Range | Example |
||---------------|---------|
| Critical fixes | 100-90 | Bug fixes, security issues |
| Features | 89-80 | New functionality |
| Quality | 79-70 | Refactoring, testing |
| Maintenance | 69-50 | Documentation, chores |
| Fallback | 49-0 | Default, catch-all |

**Example:**

```yaml
# High priority (selected first)
id: "critical-fix"
priority: 100
triggerKeywords: ["security", "critical"]

# Medium priority
id: "feature"
priority: 90
triggerKeywords: ["implement", "add"]

# Low priority (fallback)
id: "default"
priority: 0
triggerKeywords: []
```

---

## 10. Default Blueprints

### Included Blueprints

| Blueprint | ID | Priority | Keywords | Use Case |
|-----------|----|----------|----------|----------|
| Bug Fix | `bug-fix` | 100 | fix, bug, error, broken | Debugging with verification |
| Feature | `feature` | 90 | implement, add, feature | New functionality |
| Refactor | `refactor` | 80 | refactor, restructure | Code restructuring |
| Test | `test` | 70 | test, spec, coverage | Adding tests |
| Docs | `docs` | 50 | document, docs, readme | Documentation |
| Chore | `chore` | 40 | chore, update, maintenance | Maintenance tasks |
| Default | `default` | 0 | (none) | General tasks |

### Bug Fix Blueprint

**File:** `.blueprints/bug-fix.yaml`

**Workflow:**

```
explore (haiku) → plan (sonnet) → implement (sonnet) → lint → test → create_pr
                     ↑                                              ↑
                     │                                              │
                fix_lint ◄───────────────────────── fix_test ───────┘
```

**Key Features:**
- Fast exploration with Haiku
- Verification loop (lint → test → fix)
- Automatic PR creation

### Feature Blueprint

**File:** `.blueprints/feature.yaml`

**Workflow:**

```
plan (sonnet) → implement (sonnet) → lint → test → create_pr
                                         ↑         ↑
                                         │         │
                                    fix_lint ◄─ fix_test
```

**Key Features:**
- Planning phase before implementation
- Multi-model implementation
- Comprehensive verification

### Refactor Blueprint

**File:** `.blueprints/refactor.yaml`

**Workflow:**

```
analyze (sonnet) → plan (sonnet) → implement (sonnet) → lint → test → create_pr
                                                        ↑         ↑
                                                        │         │
                                                   fix_lint ◄─ fix_test
```

**Key Features:**
- Analysis phase to understand current code
- Behavior preservation through tests
- Incremental verification

### Test Blueprint

**File:** `.blueprints/test.yaml`

**Workflow:**

```
implement (sonnet) → run_test → create_pr
                            ↑
                            │
                        fix_test
```

**Key Features:**
- Test-focused prompts
- Quick verification
- Simple test → fix cycle

### Docs Blueprint

**File:** `.blueprints/docs.yaml`

**Workflow:**

```
implement (haiku) → done
```

**Key Features:**
- Fast model for quick documentation
- Simple workflow (no testing)
- Optimized for documentation tools

### Chore Blueprint

**File:** `.blueprints/chore.yaml`

**Workflow:**

```
implement (haiku) → done
```

**Key Features:**
- Fast execution with Haiku
- Minimal workflow
- Essential tools only

### Default Blueprint

**File:** `.blueprints/default.yaml`

**Workflow:**

```
implement (sonnet) → done
```

**Key Features:**
- Catch-all for unmatched tasks
- Full tool access
- No verification loop

---

## 11. API Reference

### Loading API

```typescript
// Load blueprints from directory
async function loadBlueprints(options?: LoaderOptions): Promise<Blueprint[]>

interface LoaderOptions {
  blueprintsDir?: string;  // Default: '.blueprints'
  validate?: boolean;      // Default: true
}

// BlueprintLoader class
class BlueprintLoader {
  constructor(options?: LoaderOptions);
  async loadAll(): Promise<Blueprint[]>;
  parse(content: string, filePath?: string): Blueprint;
}
```

### Selection API

```typescript
// Select blueprint by task
function selectBlueprint(
  task: string,
  blueprints: Blueprint[]
): BlueprintSelection

interface BlueprintSelection {
  blueprint: Blueprint;
  confidence: number;       // 0.0 to 1.0
  matchedKeywords: string[];
}

// Get blueprint by ID
function getBlueprintById(
  id: string,
  blueprints: Blueprint[]
): Blueprint | undefined

// List all blueprints
function listBlueprints(blueprints: Blueprint[]): Blueprint[]
```

### Compilation API

```typescript
// Compile blueprint to LangGraph
function compileBlueprint(
  blueprint: Blueprint,
  actionRegistry: ActionRegistry
): CompiledStateGraph

class BlueprintCompiler {
  constructor(actionRegistry: ActionRegistry);
  compile(blueprint: Blueprint): CompiledStateGraph;
}
```

### Action Registry API

```typescript
// Global action registry
const actionRegistry: ActionRegistry

// Register built-in actions
function registerBuiltinActions(): void

class ActionRegistry {
  register(action: DeterministicAction): void;
  get(name: string): DeterministicAction | undefined;
  has(name: string): boolean;
  list(): DeterministicAction[];
}

interface DeterministicAction {
  name: string;
  description: string;
  execute(state: BlueprintState): Promise<ActionResult>;
}
```

### Types API

```typescript
// Blueprint types
interface Blueprint {
  id: string;
  name: string;
  description: string;
  triggerKeywords: string[];
  priority: number;
  initialState: string;
  states: Record<string, State>;
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
  next?: StateTransition;
}

interface TerminalState {
  type: "terminal";
}

interface AgentConfig {
  name?: string;
  models: string[];
  tools: string[];
  systemPrompt?: string;
}

type StateTransition = string[];

interface ConditionalTransition {
  pass?: string[];
  fail?: string[];
}

// Runtime types
interface BlueprintState {
  input: string;
  currentState: string;
  lastResult?: ActionResult;
  error?: string;
}

interface ActionResult {
  success: boolean;
  output?: string;
  error?: string;
}
```

### Usage Examples

#### Complete Workflow

```typescript
import {
  loadBlueprints,
  selectBlueprint,
  compileBlueprint,
  registerBuiltinActions,
  actionRegistry,
} from './blueprints';

// 1. Load blueprints
const blueprints = await loadBlueprints();

// 2. Select appropriate blueprint
const task = "Fix the login bug";
const selection = selectBlueprint(task, blueprints);
console.log(`Using blueprint: ${selection.blueprint.name}`);

// 3. Register built-in actions
registerBuiltinActions();

// 4. Compile blueprint to graph
const graph = compileBlueprint(selection.blueprint, actionRegistry);

// 5. Execute graph
const result = await graph.invoke({
  input: task,
  currentState: selection.blueprint.initialState,
  lastResult: undefined,
  error: undefined,
});

console.log('Result:', result);
```

#### Custom Action Registration

```typescript
import { actionRegistry } from './blueprints';
import type { DeterministicAction, ActionResult, BlueprintState } from './blueprints';

// Define custom action
const myAction: DeterministicAction = {
  name: "my_action",
  description: "My custom action",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    // Your logic here
    return { success: true, output: "Action completed" };
  },
};

// Register action
actionRegistry.register(myAction);

// Use in blueprint YAML
/*
states:
  my_state:
    type: "deterministic"
    action: "my_action"
    on:
      pass: ["done"]
      fail: ["fix"]
*/
```

#### Validation

```typescript
import { BlueprintLoader, BlueprintValidationError } from './blueprints';

const loader = new BlueprintLoader({ validate: true });

try {
  const blueprints = await loader.loadAll();
  console.log(`Loaded ${blueprints.length} blueprints`);
} catch (error) {
  if (error instanceof BlueprintValidationError) {
    console.error(`Validation errors in blueprint '${error.blueprintId}':`);
    error.errors.forEach(err => console.error(`  - ${err}`));
  } else {
    throw error;
  }
}
```

---

## Additional Resources

- **Examples:** `.blueprints/examples/` - Example blueprint YAML files
- **Source Code:** `src/blueprints/` - Blueprint implementation
- **Stripe Minions:** [Original inspiration](https://stripe.com/blog/minions)
- **LangGraph:** [State graph documentation](https://langchain-ai.github.io/langgraph/)

---

**Last Updated:** 2025-04-26
