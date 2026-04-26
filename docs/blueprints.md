# Blueprint System Documentation

The Bullhorse blueprint system is a state machine workflow framework inspired by [Stripe Minions](https://stripe.com/blog/minions). Blueprints define workflows that intermix agent nodes (LLM-powered reasoning) and deterministic nodes (shell commands, validation, etc.) to create robust, verifiable development pipelines.

## Table of Contents

1. [Overview](#1-overview) - System architecture and design philosophy
2. [Core Concepts](#2-core-concepts) - Blueprint structure and types
3. [YAML Format Reference](#3-yaml-format-reference) - Complete field documentation
4. [Loading Blueprints](#4-loading-blueprints) - Loading and validation
5. [Selection Logic](#5-selection-logic) - Automatic blueprint selection
6. [Compilation](#6-compilation) - Converting blueprints to LangGraph
7. [State Transitions](#7-state-transitions) - Simple and conditional transitions
8. [Built-in Actions](#8-built-in-actions) - Deterministic node implementations
9. [Custom Actions](#9-custom-actions) - Creating and registering actions
10. [Creating Blueprints](#10-creating-blueprints) - Writing custom blueprints
11. [Default Blueprints](#11-default-blueprints) - Included blueprint examples
12. [API Reference](#12-api-reference) - Complete API documentation
13. [Agent Configuration](#13-agent-configuration) - Models, tools, and system prompts

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

### Trigger Keywords Pattern

The trigger keywords system uses regex-based pattern matching with performance optimizations to automatically select the appropriate blueprint for a given task.

#### How Keyword Matching Works

**1. Pattern Compilation**

Each blueprint's trigger keywords are compiled into efficient regex patterns:

```typescript
// Blueprint with keywords: ["fix", "bug", "error"]
// → Compiled to: /^(fix|bug|error)$/i

const pattern = blueprint.triggerKeywords
  .map(k => k.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&'))  // Escape special chars
  .join('|');  // Join with OR operator

const fastPathRegex = new RegExp(pattern, 'i');  // Case-insensitive
```

**Key Features:**
- **Special character escaping**: Characters like `.`, `*`, `?`, `$`, etc. are escaped to match literally
- **Case-insensitive**: Matching works regardless of letter case
- **OR logic**: Any keyword in the array can trigger the blueprint

**2. Two-Stage Matching**

The selection process uses two regex patterns for efficiency:

```typescript
interface CompiledBlueprint {
  fastPathRegex: RegExp;              // Quick check: matches ANY keyword
  keywordRegexes: {                   // Detailed check: identifies WHICH keywords
    keyword: string;
    regex: RegExp;
  }[];
}
```

**Stage 1: Fast Path Check**
```typescript
// Quick check: Does ANY keyword match?
if (fastPathRegex.test(task)) {
  // Proceed to stage 2
}
```

**Stage 2: Keyword Identification**
```typescript
// Identify which specific keywords matched
const matchedKeywords: string[] = [];
for (const { keyword, regex } of keywordRegexes) {
  if (regex.test(task)) {
    matchedKeywords.push(keyword);
  }
}
```

**3. Confidence Calculation**

Confidence score represents how well the task matches the blueprint:

```typescript
confidence = matchedKeywords.length / totalKeywords.length
```

| Matched Keywords | Total Keywords | Confidence | Interpretation |
|-----------------|----------------|------------|----------------|
| 3 | 3 | 1.0 | Perfect match |
| 2 | 3 | 0.67 | Strong match |
| 1 | 3 | 0.33 | Weak match |
| 0 | 3 | 0.0 | No match |

#### Priority and Selection Order

**Blueprints are evaluated in priority order (highest first):**

```typescript
// Blueprints sorted by priority (descending)
const sorted = [
  { id: 'critical-fix', priority: 100, triggerKeywords: ['security', 'critical'] },
  { id: 'bug-fix', priority: 90, triggerKeywords: ['fix', 'bug'] },
  { id: 'feature', priority: 80, triggerKeywords: ['implement', 'add'] },
  { id: 'default', priority: 0, triggerKeywords: [] }
];
```

**Selection Process:**

1. Iterate through blueprints in priority order
2. For each blueprint, test if ANY keyword matches the task
3. Return the FIRST blueprint with a matching keyword
4. If no blueprint matches, return the `default` blueprint

**Example:**

```typescript
const task = "Fix the security vulnerability in authentication";

// Iteration 1: critical-fix (priority 100)
// Keywords: ["security", "critical"]
// Match: "security" ✓
// → Returns critical-fix blueprint immediately

// Even though "fix" would match bug-fix, critical-fix wins due to higher priority
```

#### Caching and Performance

**Blueprint compilation results are cached using WeakMap:**

```typescript
const compiledCache = new WeakMap<Blueprint, CompiledBlueprint>();

function getCompiledBlueprint(blueprint: Blueprint): CompiledBlueprint {
  let compiled = compiledCache.get(blueprint);
  if (!compiled) {
    // Compile regex patterns
    compiled = { fastPathRegex, keywordRegexes };
    compiledCache.set(blueprint, compiled);
  }
  return compiled;
}
```

**Benefits:**
- Regex patterns compiled once per blueprint
- Automatic garbage collection when blueprint is no longer referenced
- O(1) lookup for subsequent selections

#### Special Character Handling

**Special regex characters are automatically escaped:**

| Keyword | Escaped Pattern | Matches |
|---------|----------------|---------|
| `fix` | `fix` | "fix", "Fix", "FIX" |
| `bug.*` | `bug\.\*` | Literal "bug.*" (not wildcard) |
| `C++` | `C\+\+` | Literal "C++" |
| `$test` | `\$test` | Literal "$test" |
| `file.js` | `file\.js` | Literal "file.js" |

**Escaped Characters:**
`. * + ? ^ $ { } ( ) | [ ] \`

#### Matching Examples

```typescript
// Blueprint: bug-fix
// Keywords: ["fix", "bug", "error"]
// Priority: 100

const examples = [
  {
    task: "Fix the login bug",
    result: {
      blueprint: "bug-fix",
      confidence: 0.67,  // 2/3 keywords matched: "fix", "bug"
      matchedKeywords: ["fix", "bug"]
    }
  },
  {
    task: "There's an error in the API",
    result: {
      blueprint: "bug-fix",
      confidence: 0.33,  // 1/3 keywords matched: "error"
      matchedKeywords: ["error"]
    }
  },
  {
    task: "Add a new feature",
    result: {
      blueprint: "default",  // No match
      confidence: 0.0,
      matchedKeywords: []
    }
  }
];
```

#### Priority Conflict Resolution

**When multiple blueprints match, priority determines the winner:**

```typescript
const blueprints = [
  {
    id: 'security-fix',
    priority: 100,
    triggerKeywords: ['security', 'vulnerability']
  },
  {
    id: 'bug-fix',
    priority: 90,
    triggerKeywords: ['fix', 'bug', 'security']  // Also has "security"
  },
  {
    id: 'feature',
    priority: 80,
    triggerKeywords: ['implement', 'add']
  }
];

const task = "Fix the security vulnerability";

// Both security-fix and bug-fix have "security" keyword
// security-fix wins because priority 100 > 90
const selection = selectBlueprint(task, blueprints);
// → { blueprint: security-fix, confidence: 1.0, matchedKeywords: ['security'] }
```

#### Best Practices for Trigger Keywords

**1. Be Specific:**

```yaml
# ❌ Too broad
triggerKeywords: ["do", "make", "create"]

# ✅ Specific
triggerKeywords: ["implement", "add", "feature"]
```

**2. Use Multiple Keywords for Better Matching:**

```yaml
# ❌ Single keyword (low confidence)
triggerKeywords: ["fix"]

# ✅ Multiple related keywords (higher confidence)
triggerKeywords: ["fix", "bug", "error", "broken"]
```

**3. Set Appropriate Priorities:**

```yaml
# High priority for specific workflows
id: "critical-fix"
priority: 100
triggerKeywords: ["security", "critical", "vulnerability"]

# Medium priority for general workflows
id: "bug-fix"
priority: 90
triggerKeywords: ["fix", "bug", "error"]

# Low priority for fallback
id: "default"
priority: 0
triggerKeywords: []
```

**4. Avoid Keyword Overlap:**

```yaml
# ❌ High overlap (confusing)
# Blueprint A: ["fix", "bug", "security"]
# Blueprint B: ["fix", "security", "vulnerability"]

# ✅ Clear separation
# Blueprint A: ["bug", "error", "broken"]
# Blueprint B: ["security", "vulnerability", "exploit"]
```

#### Edge Cases

**Empty Keyword Array:**

```typescript
// Blueprint with empty triggerKeywords is skipped during selection
{
  id: 'default',
  triggerKeywords: [],  // Skipped, selected as fallback only
  priority: 0
}
```

**No Matches:**

```typescript
// If no blueprint matches, return the "default" blueprint
const task = "Update the documentation";
// → { blueprint: default, confidence: 0, matchedKeywords: [] }
```

**Case Insensitivity:**

```typescript
// All of these match the "fix" keyword
"Fix the bug"      // ✓ Matches
"fix the bug"      // ✓ Matches
"FIX THE BUG"      // ✓ Matches
"FyX thE bUg"      // ✗ Doesn't match (exact substring match)
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

## 7. State Transitions

State transitions define how the workflow moves from one state to another based on execution results. The blueprint system supports two types of transitions: **simple transitions** for agent states and **conditional transitions** for deterministic states.

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      State Transition Flow                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐    simple edges     ┌──────────────┐         │
│   │ Agent State  │ ──────────────────► │ Next State   │         │
│   │              │    (agent chooses)  │              │         │
│   └──────────────┘                      └──────────────┘         │
│         │                                                        │
│         │ next[] array                                          │
│         ▼                                                        │
│   ┌──────────────┐                                             │
│   │ Deterministic│    conditional edges                        │
│   │ State        │ ──────────────────►  pass / fail            │
│   │              │    (based on result)                        │
│   └──────────────┘                      └──────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.1 Simple Transitions

Simple transitions are used by **agent states** where the LLM dynamically chooses which state to transition to from a list of possible next states.

#### How Simple Transitions Work

```yaml
agent_state:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write"]
  next: ["option_a", "option_b", "option_c"]
  # Agent uses reasoning to choose ONE of these options
```

**Key Characteristics:**

| Feature | Description |
|---------|-------------|
| **Array of options** | The `next` property contains multiple possible state IDs |
| **Agent choice** | The LLM evaluates the situation and selects the most appropriate next state |
| **Dynamic routing** | Different executions may choose different paths based on context |
| **No conditions** | All states in the array are equally valid choices |

#### Simple Transition Examples

**Single Next State:**

```yaml
implement:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["write", "edit"]
  next: ["verify"]  # Only one option (effectively deterministic)
```

**Multiple Next States (Branching):**

```yaml
assess:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
    systemPrompt: |
      Assess the bug complexity and choose the appropriate approach:
      - "simple_fix" for straightforward bugs
      - "complex_refactor" for architectural issues
      - "manual_review" for cases requiring human judgment
  next: ["simple_fix", "complex_refactor", "manual_review"]
```

**Pipeline Flow:**

```yaml
explore:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "code_search"]
  next: ["plan"]  # Always goes to plan

plan:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["write"]
  next: ["implement"]  # Always goes to implement

implement:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["write", "edit"]
  next: ["verify", "skip_verification"]  # Agent decides if verification is needed
```

#### How Simple Transitions Are Compiled

In the `BlueprintCompiler`, simple transitions are compiled using LangGraph's `addEdge()` method:

```typescript
// From src/blueprints/compiler.ts
private addEdges(graph: any, blueprint: Blueprint): void {
  for (const [stateId, state] of Object.entries(blueprint.states)) {
    if (state.type === "agent") {
      for (const next of state.next) {
        graph.addEdge(stateId, next);
      }
    }
  }
}
```

**What happens:**

1. Each state ID in the `next` array becomes a separate edge
2. The agent node evaluates which edge to follow during execution
3. The chosen state becomes the next `currentState` in the workflow

### 7.2 Conditional Transitions

Conditional transitions are used by **deterministic states** where the next state depends on whether the action succeeded or failed.

#### How Conditional Transitions Work

```yaml
verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["deploy"]     # If tests pass (exit code 0)
    fail: ["fix_tests"]  # If tests fail (non-zero exit code)
```

**Key Characteristics:**

| Feature | Description |
|---------|-------------|
| **Result-based** | Transition depends on action execution result |
| **Binary outcome** | Either `pass` (success) or `fail` (failure) |
| **Automatic routing** | No agent choice - determined by exit code |
| **Optional branches** | Can specify only `pass`, only `fail`, or both |

#### Conditional Transition Rules

The system evaluates conditional transitions based on the action's `ActionResult`:

```typescript
interface ActionResult {
  success: boolean;  // true = pass, false = fail
  output?: string;
  error?: string;
}
```

**Decision Logic:**

```
┌─────────────────────────────────────────────────────┐
│          Conditional Transition Logic               │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Action executes → ActionResult.success?            │
│         │                                           │
│    ┌────┴────┐                                      │
│    │         │                                      │
│  true      false                                    │
│    │         │                                      │
│    ▼         ▼                                      │
│  pass       fail                                    │
│    │         │                                      │
│    ▼         ▼                                      │
│ on.pass   on.fail                                   │
│    │         │                                      │
│    ▼         ▼                                      │
│ Pass       Fail                                     │
│ States     States                                   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Default Behavior:**

| Condition | Default Transition |
|-----------|-------------------|
| No `on.pass` specified | `["__end__"]` (workflow ends) |
| No `on.fail` specified | `["__end__"]` (workflow ends) |
| No `on` specified | `["__end__"]` (implicit terminal) |
| Both specified | Follows the appropriate branch |

#### Conditional Transition Examples

**Both Pass and Fail Paths:**

```yaml
verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["deploy"]      # Tests pass → proceed to deployment
    fail: ["fix_tests"]   # Tests fail → go back to fixing
```

**Only Pass Path (Fail Ends Workflow):**

```yaml
lint:
  type: "deterministic"
  action: "run_linters"
  on:
    pass: ["test"]  # Lint passes → test
    # fail defaults to ["__end__"] - workflow ends on lint failure
```

**Only Fail Path (Pass Ends Workflow):**

```yaml
check_blocker:
  type: "deterministic"
  action: "check_blocking_issues"
  on:
    fail: ["block"]  # Issues found → block deployment
    # pass defaults to ["__end__"] - workflow continues on success
```

**Multiple Pass/Fail States:**

```yaml
comprehensive_test:
  type: "deterministic"
  action: "run_full_test_suite"
  on:
    pass: ["deploy_staging", "notify_success"]  # Multiple success states
    fail: ["log_failure", "create_issue", "notify_team"]  # Multiple failure states
```

**Verification Loop Pattern:**

```yaml
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
    pass: ["done"]      # Tests pass → workflow complete
    fail: ["fix"]       # Tests fail → fix issues

fix:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["edit"]
    systemPrompt: "Fix the failing tests based on the error output."
  next: ["verify"]     # After fixing, verify again (loop)

done:
  type: "terminal"
```

#### How Conditional Transitions Are Compiled

In the `BlueprintCompiler`, conditional transitions are compiled using LangGraph's `addConditionalEdges()` method:

```typescript
// From src/blueprints/compiler.ts
private addEdges(graph: any, blueprint: Blueprint): void {
  for (const [stateId, state] of Object.entries(blueprint.states)) {
    if (state.type === "deterministic" && state.on) {
      graph.addConditionalEdges(
        stateId,
        (s: typeof BlueprintStateAnnotation.State) =>
          s.lastResult?.success ? "pass" : "fail",
        {
          pass: state.on.pass || ["__end__"],
          fail: state.on.fail || ["__end__"],
        },
      );
    }
  }
}
```

**What happens:**

1. A routing function checks `lastResult?.success` to determine outcome
2. The graph follows the `pass` edge if `success === true`
3. The graph follows the `fail` edge if `success === false`
4. If either branch is undefined, it defaults to `["__end__"]`

### 7.3 Transition Logic

The `BlueprintCompiler` processes transitions in a specific order, with deterministic states supporting both conditional and simple transitions.

#### Transition Priority

For **deterministic states**, the compiler checks for transitions in this order:

```
┌──────────────────────────────────────────────────┐
│         Deterministic State Transition          │
│                   Priority                       │
├──────────────────────────────────────────────────┤
│                                                  │
│  1. Check for 'on' (conditional transitions)    │
│     │                                            │
│     ├─► Found: Use conditional edges            │
│     │    (pass/fail based on result)            │
│     │                                            │
│     └─► Not found: Check for 'next'             │
│          │                                        │
│          ├─► Found: Use simple edges             │
│          │    (all states in array)              │
│          │                                        │
│          └─► Not found: Transition to __end__    │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Rules:**

| State Type | Property Checked | Behavior |
|------------|-----------------|----------|
| **Agent** | `next` (required) | Uses simple edges for all states in array |
| **Deterministic** | `on` (optional) | Uses conditional edges if specified |
| **Deterministic** | `next` (fallback) | Uses simple edges if `on` not specified |
| **Deterministic** | (neither) | Transitions to `["__end__"]` |
| **Terminal** | (none) | End of workflow |

#### Node Ends Configuration

The compiler also configures "node ends" - the possible destination states for each node:

```typescript
private getNodeEnds(state: State): string[] {
  if (state.type === "agent") {
    return state.next;
  } else if (state.type === "deterministic" && state.on) {
    return [...(state.on.pass || []), ...(state.on.fail || [])];
  }
  return [];
}
```

**Purpose:**

- Helps LangGraph optimize graph execution
- Provides visibility into all possible exit paths from a node
- Used for graph validation and visualization

#### Complete Transition Flow Example

```yaml
id: "complete-example"
initialState: "assess"

states:
  assess:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["read", "grep"]
    next: ["simple", "complex"]

  simple:
    type: "agent"
    config:
      models: ["haiku"]
      tools: ["edit"]
    next: ["verify"]

  complex:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6"]
      tools: ["write", "read"]
    next: ["verify"]

  verify:
    type: "deterministic"
    action: "run_tests"
    on:
      pass: ["deploy"]
      fail: ["fix"]

  fix:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit"]
    next: ["verify"]

  deploy:
    type: "deterministic"
    action: "deploy_to_production"
    on:
      pass: ["success"]
      fail: ["rollback"]

  rollback:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["bash"]
    next: ["notify"]

  success:
    type: "terminal"

  notify:
    type: "deterministic"
    action: "notify_team"
    # No 'on' specified → transitions to __end__
```

**Execution Paths:**

```
Simple path:
  assess ──► simple ──► verify ──► deploy ──► success (terminal)

Complex path with failure:
  assess ──► complex ──► verify ──► fix ──► verify ──► deploy ──► rollback ──► notify ──► __end__
```

### 7.4 Transition Best Practices

#### 1. Verification Loops

Always provide a fix path for verification states:

```yaml
# ✅ Good - Complete verification loop
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
  next: ["verify"]  # Loop back to verification
```

```yaml
# ❌ Bad - No fix path (tests fail → workflow ends)
verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["done"]
    # No fail path - failures end the workflow
```

#### 2. Explicit Transitions

Be explicit about transition destinations:

```yaml
# ✅ Good - Explicit transitions
check:
  type: "deterministic"
  action: "verify_types"
  on:
    pass: ["continue"]
    fail: ["fix_types", "log_error"]  # Clear failure path
```

```yaml
# ❌ Bad - Implicit end state
check:
  type: "deterministic"
  action: "verify_types"
  # No 'on' - failures silently end the workflow
```

#### 3. Agent State Branching

Use agent states for intelligent routing:

```yaml
# ✅ Good - Agent chooses based on context
assess:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
    systemPrompt: |
      Analyze the bug and choose the appropriate fix approach:
      - "quick_fix" for simple bugs (< 10 lines)
      - "refactor" for complex issues requiring architectural changes
      - "investigate" for bugs requiring deeper research
  next: ["quick_fix", "refactor", "investigate"]
```

```yaml
# ❌ Bad - Deterministic state for decision-making
assess:
  type: "deterministic"
  action: "check_bug_type"
  on:
    pass: ["quick_fix"]  # Can't handle multiple outcomes
    fail: ["refactor"]
```

#### 4. Terminal State Placement

Always end workflows explicitly:

```yaml
# ✅ Good - Explicit terminal state
verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["done"]      # Explicit terminal state
    fail: ["fix"]

done:
  type: "terminal"
```

```yaml
# ⚠️ Acceptable - Implicit terminal (for unimportant branches)
notify:
  type: "deterministic"
  action: "send_notification"
  # No 'on' - transitions to __end__ automatically
```

#### 5. Avoid Infinite Loops

Ensure loops have exit conditions:

```yaml
# ✅ Good - Loop with exit
verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["deploy"]  # Exit path on success
    fail: ["fix"]

fix:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["edit"]
    systemPrompt: |
      Fix the failing tests. If you've attempted 3+ times,
      transition to 'manual_review' instead of 'verify'.
  next: ["verify", "manual_review"]  # Possible exit from loop

manual_review:
  type: "terminal"
```

```yaml
# ❌ Bad - Potential infinite loop
fix:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["edit"]
  next: ["verify"]  # Always goes back to verify, no other option

verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["deploy"]
    fail: ["fix"]  # If fix never succeeds, infinite loop
```

### 7.5 Transition Patterns

#### Pattern 1: Linear Pipeline

```yaml
step1:
  type: "agent"
  next: ["step2"]

step2:
  type: "agent"
  next: ["step3"]

step3:
  type: "agent"
  next: ["done"]

done:
  type: "terminal"
```

#### Pattern 2: Verification Loop

```yaml
implement:
  type: "agent"
  next: ["verify"]

verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["done"]
    fail: ["fix"]

fix:
  type: "agent"
  next: ["verify"]  # Loop back

done:
  type: "terminal"
```

#### Pattern 3: Multi-Branch with Convergence

```yaml
assess:
  type: "agent"
  next: ["branch_a", "branch_b", "branch_c"]

branch_a:
  type: "agent"
  next: ["merge"]

branch_b:
  type: "agent"
  next: ["merge"]

branch_c:
  type: "agent"
  next: ["merge"]

merge:
  type: "deterministic"
  action: "finalize"
  on:
    pass: ["done"]

done:
  type: "terminal"
```

#### Pattern 4: Progressive Enhancement

```yaml
quick_check:
  type: "deterministic"
  action: "basic_lint"
  on:
    pass: ["deploy"]
    fail: ["full_check"]

full_check:
  type: "deterministic"
  action: "comprehensive_test"
  on:
    pass: ["deploy"]
    fail: ["fix"]

deploy:
  type: "terminal"
```

---

## 8. Built-in Actions

### Action Registry

The `ActionRegistry` class manages deterministic actions that can be used in blueprint states. It provides a centralized registry pattern for registering, retrieving, and listing actions.

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

#### ActionRegistry Class

The `ActionRegistry` class provides the following methods:

| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| `register(action)` | `DeterministicAction` | `void` | Register an action in the registry. Throws if action with same name exists. |
| `get(name)` | `string` | `DeterministicAction \| undefined` | Retrieve an action by name. |
| `has(name)` | `string` | `boolean` | Check if an action is registered. |
| `list()` | - | `DeterministicAction[]` | List all registered actions. |

#### How Action Registration Works

The action registry uses a `Map<string, DeterministicAction>` internally to store actions:

```typescript
// From src/blueprints/actions.ts
export class ActionRegistry {
  private actions = new Map<string, DeterministicAction>();

  register(action: DeterministicAction): void {
    if (this.actions.has(action.name)) {
      throw new Error(`Action "${action.name}" is already registered`);
    }
    this.actions.set(action.name, action);
  }

  get(name: string): DeterministicAction | undefined {
    return this.actions.get(name);
  }

  list(): DeterministicAction[] {
    return Array.from(this.actions.values());
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }
}
```

**Key Features:**

- **Duplicate prevention**: Registering an action with an existing name throws an error
- **Type safety**: Uses TypeScript types for compile-time and runtime safety
- **Encapsulation**: Private `actions` Map prevents direct modification
- **Immutability**: Actions cannot be modified once registered

#### Registry Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                   Action Registry Lifecycle                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Application Startup                                    │
│     │                                                       │
│     ├─► Create ActionRegistry instance                     │
│     │   const registry = new ActionRegistry();             │
│     │                                                       │
│     ├─► Register built-in actions                          │
│     │   registerBuiltinActions();                          │
│     │                                                       │
│     └─► Register custom actions (optional)                 │
│         registry.register(customAction);                   │
│                                                             │
│  2. Blueprint Compilation                                  │
│     │                                                       │
│     ├─► Pass registry to compiler                         │
│     │   const compiler = new BlueprintCompiler(registry);  │
│     │                                                       │
│     └─► Compiler resolves action names to implementations  │
│         const action = registry.get(state.action);         │
│                                                             │
│  3. Blueprint Execution                                    │
│     │                                                       │
│     ├─► Deterministic state executes                      │
│     │   const result = await action.execute(state);        │
│     │                                                       │
│     └─► Result determines next state                      │
│         pass → on.pass states                              │
│         fail → on.fail states                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Global Registry Instance

The system exports a global registry instance for convenience:

```typescript
// Global registry instance (singleton pattern)
export const actionRegistry = new ActionRegistry();

// Built-in actions are registered to this global instance
export function registerBuiltinActions(): void {
  actionRegistry.register(runLintersAction);
  actionRegistry.register(runTestsAction);
  actionRegistry.register(runTypecheckAction);
  actionRegistry.register(createPrAction);
}
```

**Usage Patterns:**

```typescript
// Pattern 1: Use global registry (recommended for most cases)
import { actionRegistry, registerBuiltinActions } from './blueprints';

registerBuiltinActions();
actionRegistry.register(myCustomAction);

// Pattern 2: Create isolated registry (for testing or isolation)
import { ActionRegistry } from './blueprints';

const myRegistry = new ActionRegistry();
myRegistry.register(myCustomAction);
const compiler = new BlueprintCompiler(myRegistry);
```

#### Registering Custom Actions

To register a custom deterministic action:

**Step 1: Define the action**

```typescript
import type { DeterministicAction, ActionResult, BlueprintState } from './blueprints';

const formatCodeAction: DeterministicAction = {
  name: "format_code",
  description: "Format code with prettier",
  execute: async (_state: BlueprintState): Promise<ActionResult> => {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      const { stdout, stderr } = await execFileAsync('npx', ['prettier', '--write', '.']);
      return { success: true, output: stdout || "Code formatted" };
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      return {
        success: false,
        error: err.stderr || err.message || "Formatting failed",
      };
    }
  },
};
```

**Step 2: Register the action**

```typescript
import { actionRegistry } from './blueprints';

// Option A: Register directly to global registry
actionRegistry.register(formatCodeAction);

// Option B: Register during initialization
function initializeActions(): void {
  registerBuiltinActions();      // Register built-in actions
  actionRegistry.register(formatCodeAction);  // Then register custom actions
}
```

**Step 3: Use in blueprint YAML**

```yaml
states:
  format:
    type: "deterministic"
    action: "format_code"
    on:
      pass: ["commit"]
      fail: ["fix_format"]
```

#### Action Registration Best Practices

**1. Register Early**

Register actions before compiling blueprints:

```typescript
// ✅ Good - Register before compilation
async function main() {
  registerBuiltinActions();
  actionRegistry.register(myCustomAction);

  const blueprints = await loadBlueprints();
  const graph = compileBlueprint(blueprints[0], actionRegistry);
}

// ❌ Bad - Register after compilation
async function main() {
  const blueprints = await loadBlueprints();
  const graph = compileBlueprint(blueprints[0], actionRegistry);

  // Too late! Blueprint already compiled
  actionRegistry.register(myCustomAction);
}
```

**2. Group Related Actions**

Organize action registration by functionality:

```typescript
// actions/git.ts
export const gitActions: DeterministicAction[] = [
  { name: "git_status", ... },
  { name: "git_commit", ... },
  { name: "git_push", ... },
];

// actions/test.ts
export const testActions: DeterministicAction[] = [
  { name: "run_unit_tests", ... },
  { name: "run_integration_tests", ... },
  { name: "run_e2e_tests", ... },
];

// Register in batches
import { actionRegistry } from './blueprints';
import { gitActions } from './actions/git';
import { testActions } from './actions/test';

function registerCustomActions(): void {
  gitActions.forEach(action => actionRegistry.register(action));
  testActions.forEach(action => actionRegistry.register(action));
}
```

**3. Handle Duplicate Names**

Check for existing actions before registering:

```typescript
function registerCustomAction(action: DeterministicAction): void {
  if (actionRegistry.has(action.name)) {
    console.warn(`Action "${action.name}" already registered, skipping`);
    return;
  }
  actionRegistry.register(action);
}

// Or override built-in actions (not recommended)
function overrideAction(action: DeterministicAction): void {
  if (actionRegistry.has(action.name)) {
    console.warn(`Overriding built-in action: ${action.name}`);
    // Note: The built-in register() throws on duplicates
    // You'd need to create a new registry to override
  }
  actionRegistry.register(action);
}
```

**4. Provide Descriptive Names and Descriptions**

```typescript
// ✅ Good - Clear and descriptive
const runTypeCheckAction: DeterministicAction = {
  name: "run_typecheck",
  description: "Run TypeScript type checking",
  execute: async (_state) => { ... },
};

// ❌ Bad - Vague
const action1: DeterministicAction = {
  name: "do_something",
  description: "Does stuff",
  execute: async (_state) => { ... },
};
```

**5. Access Blueprint State When Needed**

```typescript
const contextualAction: DeterministicAction = {
  name: "contextual_action",
  description: "Action that uses blueprint state",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    // Access original task input
    const task = state.input;

    // Access current state ID
    const currentStateId = state.currentState;

    // Access previous action result
    const lastResult = state.lastResult;

    // Access error if present
    const error = state.error;

    // Use context to make decisions
    if (lastResult?.success) {
      return { success: true, output: "Continuing from success" };
    } else {
      return { success: false, error: "Cannot continue" };
    }
  },
};
```

#### Registry in Compilation

The `BlueprintCompiler` uses the action registry during compilation:

```typescript
// From src/blueprints/compiler.ts
class BlueprintCompiler {
  constructor(private actionRegistry: ActionRegistry) {}

  compile(blueprint: Blueprint): CompiledStateGraph {
    // ...

    // For each deterministic state, verify action exists
    for (const [stateId, state] of Object.entries(blueprint.states)) {
      if (state.type === "deterministic") {
        const action = this.actionRegistry.get(state.action);
        if (!action) {
          throw new BlueprintCompilerError(
            "unknown_action",
            `Action not found: ${state.action}`
          );
        }
      }
    }

    // ...
  }
}
```

**Compilation validation:**

| Check | Error | Description |
|-------|-------|-------------|
| Action exists | `Action not found: {name}` | Action name not in registry |
| Action registered | `Action "{name}" is already registered` | Duplicate registration |

#### Testing Custom Actions

```typescript
import { ActionRegistry } from './blueprints';
import type { DeterministicAction, ActionResult, BlueprintState } from './blueprints';

describe('Custom Action', () => {
  let registry: ActionRegistry;

  beforeEach(() => {
    // Create fresh registry for each test
    registry = new ActionRegistry();
  });

  it('should register custom action', () => {
    const action: DeterministicAction = {
      name: "test_action",
      description: "Test action",
      execute: async () => ({ success: true }),
    };

    registry.register(action);
    expect(registry.has('test_action')).toBe(true);
  });

  it('should execute action with state', async () => {
    const action: DeterministicAction = {
      name: "stateful_action",
      description: "Action that uses state",
      execute: async (state: BlueprintState) => {
        return {
          success: true,
          output: `Task: ${state.input}`,
        };
      },
    };

    registry.register(action);
    const registeredAction = registry.get('stateful_action');

    const result = await registeredAction!.execute({
      input: "Test task",
      currentState: "start",
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("Task: Test task");
  });

  it('should throw on duplicate registration', () => {
    const action: DeterministicAction = {
      name: "duplicate",
      description: "Test",
      execute: async () => ({ success: true }),
    };

    registry.register(action);

    expect(() => {
      registry.register(action);
    }).toThrow('Action "duplicate" is already registered');
  });
});
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

## 9. Custom Actions

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

## 10. Creating Blueprints

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

## 11. Default Blueprints

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

## 12. API Reference

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

## 13. Agent Configuration

Agent configuration is the heart of blueprint-based workflows. The `AgentConfig` interface defines how agent states behave, which models they use, what tools they can access, and how they're instructed to approach tasks.

### Overview

Every agent state in a blueprint requires an `AgentConfig` object:

```typescript
interface AgentConfig {
  /** Optional display name for this agent instance */
  name?: string;

  /** Model array for fallback (tries in order) */
  models: string[];

  /** Tool allowlist (only these tools available) */
  tools: string[];

  /** Optional custom system prompt */
  systemPrompt?: string;
}
```

**Key Principles:**

| Principle | Description | Example |
|-----------|-------------|---------|
| **Least Privilege** | Only grant tools that are necessary for the task | Exploration states get read-only tools |
| **Model Optimization** | Use cheaper models for simple tasks, premium for complex reasoning | Haiku for exploration, Sonnet for implementation |
| **Graceful Degradation** | Fallback chains ensure reliability even if primary model fails | `models: ["sonnet", "haiku"]` |
| **Task-Specific Prompts** | Custom system prompts guide agent behavior for specific states | Different prompts for planning vs. implementing |

### 13.1 Models Array

The `models` array specifies which LLM models to use, in priority order. The system tries each model sequentially until one succeeds.

#### How Model Fallback Works

```
┌─────────────────────────────────────────────────────────────┐
│                   Model Fallback Flow                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Agent State Execution                                      │
│       │                                                     │
│       ├─► Try models[0] (sonnet)                            │
│       │     │                                               │
│       │     ├─► Success → Continue workflow                │
│       │     │                                               │
│       │     └─► Error/Failure → Try next model             │
│       │                            │                        │
│       │                            ▼                        │
│       │                     Try models[1] (haiku)           │
│       │                            │                        │
│       │                            ├─► Success → Continue  │
│       │                            │                        │
│       │                            └─► Error → Fail state  │
│       │                                                     │
│       └─► If all models fail → Workflow error              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Available Models

| Model ID | Speed | Cost | Quality | Context Window | Best Use Case |
|----------|-------|------|---------|----------------|---------------|
| `haiku` | Fast | Low | Good | 200K tokens | Exploration, documentation, simple edits |
| `sonnet` | Medium | Medium | High | 200K tokens | Most code work, bug fixes, refactoring |
| `claude-sonnet-4-6` | Slower | Higher | Best | 200K tokens | Planning, architecture, complex reasoning |

#### Model Selection Strategy

**Single Model (No Fallback):**

```yaml
analyze:
  type: "agent"
  config:
    models: ["sonnet"]  # Only tries Sonnet
    tools: ["read", "grep"]
  next: ["implement"]
```

**Use Case:** When you're confident the model will succeed and don't want to pay for fallback attempts.

**Fallback Chain (Recommended):**

```yaml
implement:
  type: "agent"
  config:
    models: ["sonnet", "haiku"]  # Try Sonnet, fall back to Haiku
    tools: ["write", "edit"]
  next: ["verify"]
```

**Use Case:** Balancing quality and cost. Primary model for best results, cheaper fallback for reliability.

**Progressive Escalation:**

```yaml
investigate:
  type: "agent"
  config:
    models: ["haiku", "sonnet", "claude-sonnet-4-6"]
    tools: ["read", "semantic_search"]
    systemPrompt: "Start with Haiku for quick investigation. If complexity is high, the system will automatically escalate."
  next: ["report"]
```

**Use Case:** When task complexity is unknown. Start fast, escalate if needed.

#### Cost Optimization Patterns

**Fast Exploration, Quality Implementation:**

```yaml
# Fast exploration with Haiku (~$0.25/1M tokens)
explore:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["code_search", "read"]
  next: ["plan"]

# Quality planning with Sonnet (~$3/1M tokens)
plan:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
  next: ["implement"]

# Implementation with fallback
implement:
  type: "agent"
  config:
    models: ["sonnet", "haiku"]  # Quality primary, cost fallback
    tools: ["write", "edit"]
  next: ["done"]
```

**Estimated Cost for Typical Workflow:**
- Exploration (Haiku): ~500 tokens × $0.25/M = $0.000125
- Planning (Sonnet): ~2,000 tokens × $3/M = $0.006
- Implementation (Sonnet): ~5,000 tokens × $3/M = $0.015
- **Total:** ~$0.021 per workflow execution

#### Model Selection Guidelines

| Task Complexity | Recommended Model | Fallback | Rationale |
|----------------|-------------------|----------|-----------|
| **Simple** (file reading, basic edits) | `haiku` | none | Fast and cheap, sufficient for simple tasks |
| **Medium** (bug fixes, refactoring) | `sonnet` | `haiku` | Quality first, cost fallback |
| **Complex** (architecture, planning) | `claude-sonnet-4-6` | `sonnet`, `haiku` | Best reasoning, multiple fallbacks |
| **Unknown** (exploration) | `haiku` | `sonnet` | Start cheap, escalate if needed |

#### Common Anti-Patterns

**❌ Anti-Pattern 1: Over-Engineering Simple Tasks**

```yaml
# Bad: Using premium model for trivial task
read_readme:
  type: "agent"
  config:
    models: ["claude-sonnet-4-6"]  # Overkill
    tools: ["read"]
  next: ["done"]
```

**✅ Better: Use appropriate model**

```yaml
read_readme:
  type: "agent"
  config:
    models: ["haiku"]  # Fast and cheap
    tools: ["read"]
  next: ["done"]
```

**❌ Anti-Pattern 2: No Fallback for Critical Tasks**

```yaml
# Bad: If model fails, entire workflow fails
implement:
  type: "agent"
  config:
    models: ["claude-sonnet-4-6"]  # Single point of failure
    tools: ["write", "edit"]
  next: ["verify"]
```

**✅ Better: Provide fallback**

```yaml
implement:
  type: "agent"
  config:
    models: ["claude-sonnet-4-6", "sonnet", "haiku"]  # Multiple fallbacks
    tools: ["write", "edit"]
  next: ["verify"]
```

**❌ Anti-Pattern 3: Reverse Priority (Expensive First)**

```yaml
# Bad: Tries expensive model first, wastes money
implement:
  type: "agent"
  config:
    models: ["claude-sonnet-4-6", "sonnet", "haiku"]  # Always tries most expensive first
    tools: ["write"]
  next: ["done"]
```

**✅ Better: Start with appropriate model**

```yaml
# For typical implementation: Sonnet is usually sufficient
implement:
  type: "agent"
  config:
    models: ["sonnet", "haiku"]  # Quality primary, cheap fallback
    tools: ["write"]
  next: ["done"]
```

### 13.2 Tool Allowlisting

The `tools` array specifies which tools the agent can use. This is a security and control feature - agents can only use tools explicitly listed.

#### How Tool Allowlisting Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Tool Allowlisting                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Agent Request: "I want to edit src/app.ts"                 │
│       │                                                     │
│       ▼                                                     │
│  Tool Allowlist Check                                       │
│       │                                                     │
│       ├─► Is "edit" in tools[]?                             │
│       │     │                                               │
│       │     ├─► Yes → Allow tool execution                 │
│       │     │                                               │
│       │     └─► No → Deny with error message               │
│       │                                                     │
│       └─► Agent can only use allowed tools                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Available Tools

| Tool Name | Description | Risk Level | Best For |
|-----------|-------------|------------|----------|
| `read` | Read file contents | None | Exploration, analysis |
| `code_search` | Search code by pattern | None | Finding files, patterns |
| `grep` | Search text in files | None | Text search, content analysis |
| `semantic_search` | Search by meaning | None | Conceptual queries ("where is auth?") |
| `write` | Write new files | Medium | Creating new files |
| `edit` | Edit existing files | High | Modifying code |
| `bash` | Execute shell commands | Critical | Running tests, git operations |

#### Tool Categories by Use Case

**Read-Only Exploration (Safe):**

```yaml
explore:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "code_search", "grep", "semantic_search"]
  next: ["report"]
```

**Use Case:** Initial exploration, understanding codebase, finding files. No risk of modifications.

**Code Modification (Controlled Risk):**

```yaml
implement:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit"]  # Can modify files
  next: ["verify"]
```

**Use Case:** Making code changes. Includes read tools for understanding before editing.

**Full Access (High Risk):**

```yaml
fix:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit", "bash"]  # Everything
  next: ["verify"]
```

**Use Case:** Complex fixes that may require running tests, git operations, or multiple file modifications.

#### Security Best Practices

**Principle of Least Privilege:**

```yaml
# ✅ Good: Only grant necessary tools
analyze_code:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "grep"]  # Can't modify anything
  next: ["report"]

# ❌ Bad: Unnecessary tool access
analyze_code:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "write", "edit", "bash"]  # Dangerous for analysis task
  next: ["report"]
```

**Progressive Tool Access:**

```yaml
# Stage 1: Read-only exploration
explore:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "code_search"]
  next: ["plan"]

# Stage 2: Planning (still read-only)
plan:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep", "semantic_search"]
  next: ["implement"]

# Stage 3: Implementation (write access)
implement:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit"]  # Now allow modifications
  next: ["verify"]

# Stage 4: Verification (bash access)
verify:
  type: "deterministic"
  action: "run_tests"
  on:
    pass: ["done"]
    fail: ["fix"]  # Fix gets full access
```

#### Tool Selection Guidelines

| Task | Recommended Tools | Rationale |
|------|-------------------|-----------|
| **Explore codebase** | `read`, `code_search`, `grep` | Read-only, comprehensive search |
| **Find by concept** | `semantic_search`, `read` | Meaning-based search |
| **Create new files** | `write`, `read` | No edit needed for new files |
| **Modify existing code** | `read`, `edit` | Read first, then edit |
| **Complex multi-file** | `read`, `write`, `edit`, `bash` | Full access for complex changes |
| **Debug tests** | `read`, `edit`, `bash` | bash to run tests, edit to fix |

#### Tool Allowlisting Examples

**Example 1: Documentation Task (Read + Write)**

```yaml
# Safe: Can create new docs, can't modify code
update_docs:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "write"]  # No "edit" - can't modify existing files
  next: ["done"]
```

**Example 2: Bug Fix (Full Access)**

```yaml
# Necessary: Bug fixes may require any operation
fix_bug:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit", "bash", "grep"]
  next: ["verify"]
```

**Example 3: Code Review (Read-Only)**

```yaml
# Safe: Reviewers shouldn't modify code
review:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep", "code_search"]  # Read-only tools only
  next: ["approve"]
```

**Example 4: Refactoring (Read + Edit)**

```yaml
# Targeted: Refactoring modifies existing code
refactor:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "edit", "grep"]  # Edit for changes, grep for finding
  next: ["verify"]
```

#### Common Anti-Patterns

**❌ Anti-Pattern 1: Over-Permission**

```yaml
# Bad: Giving bash access for simple analysis
analyze:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit", "bash"]  # Too much power
  next: ["report"]
```

**✅ Better: Minimum required tools**

```yaml
analyze:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "grep"]  # Sufficient for analysis
  next: ["report"]
```

**❌ Anti-Pattern 2: Missing Read Tools**

```yaml
# Bad: Can edit but can't read existing code
modify:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["write", "edit"]  # Missing "read"!
  next: ["done"]
```

**✅ Better: Include read tools**

```yaml
modify:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit"]  # Read before editing
  next: ["done"]
```

### 13.3 System Prompt

The `systemPrompt` field allows you to override the default agent instructions for a specific state. This is powerful for guiding agent behavior.

#### When to Use Custom System Prompts

| Use Case | Example | Benefit |
|----------|---------|---------|
| **Task-Specific Instructions** | Bug fix vs. feature implementation | Tailored approach to different task types |
| **Constraint Enforcement** | "Only modify tests, not production code" | Prevents unintended changes |
| **Output Format** | "Return JSON with specific fields" | Structured, parseable outputs |
| **Behavior Guidance** | "Be conservative vs. be aggressive" | Adjusts agent's decision-making |
| **Role Definition** | "You are a security reviewer" | Context-appropriate perspective |

#### System Prompt Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                 System Prompt Priority                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Blueprint systemPrompt (Highest Priority)               │
│     │                                                       │
│     ├─► Overrides all other prompts                        │
│     ├─► Used when: State-specific behavior needed           │
│     └─► Example: "Fix tests, don't modify production code"  │
│                                                             │
│  2. Agent harness default prompt                            │
│     │                                                       │
│     ├─► Used when: No systemPrompt in blueprint            │
│     ├─► General-purpose instructions                        │
│     └─► Example: "You are a helpful coding assistant"       │
│                                                             │
│  3. Model base prompt (Lowest Priority)                     │
│     │                                                       │
│     ├─► Model's default behavior                            │
│     ├─► Used when: No other prompts provided               │
│     └─► Example: Model's built-in personality              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Writing Effective System Prompts

**Principle 1: Be Specific and Actionable**

```yaml
# ❌ Vague
analyze:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
    systemPrompt: "Analyze the code well."  # Too vague
  next: ["report"]

# ✅ Specific
analyze:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
    systemPrompt: |
      Analyze the code for:
      1. Security vulnerabilities (SQL injection, XSS, etc.)
      2. Performance issues (N+1 queries, missing indexes)
      3. Code smell (long functions, deep nesting)

      For each issue found, provide:
      - File path and line number
      - Severity level (critical/high/medium/low)
      - Specific recommendation for fix
  next: ["report"]
```

**Principle 2: Define Constraints Explicitly**

```yaml
# ❌ Implicit constraints
fix_tests:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "edit"]
    systemPrompt: "Fix the failing tests."  # Doesn't say what NOT to do
  next: ["verify"]

# ✅ Explicit constraints
fix_tests:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "edit"]
    systemPrompt: |
      Fix the failing tests with these constraints:
      - ONLY modify files in tests/ directory
      - DO NOT change production code (src/)
      - DO NOT modify test assertions, only implementation
      - Preserve test structure and naming

      If tests fail due to production code bugs:
      - Document the issue in a comment
      - DO NOT fix the production code yourself
  next: ["verify"]
```

**Principle 3: Provide Context and Examples**

```yaml
# ✅ Rich context with examples
refactor:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "edit"]
    systemPrompt: |
      Refactor the code to improve maintainability while preserving behavior.

      Refactoring goals:
      1. Extract repeated logic into functions
      2. Simplify complex conditions
      3. Improve naming clarity
      4. Reduce cognitive complexity

      Example transformation:

      Before:
      ```typescript
      if (user && user.profile && user.profile.settings && user.profile.settings.notifications) {
        // ...
      }
      ```

      After:
      ```typescript
      const hasNotificationsEnabled = user?.profile?.settings?.notifications ?? false;
      if (hasNotificationsEnabled) {
        // ...
      }
      ```

      Constraints:
      - DO NOT change external interfaces
      - DO NOT alter behavior (only structure)
      - Run tests after each change
  next: ["verify"]
```

#### Common System Prompt Patterns

**Pattern 1: Role-Based Prompting**

```yaml
security_review:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
    systemPrompt: |
      You are a security reviewer with expertise in:
      - OWASP Top 10 vulnerabilities
      - Common security anti-patterns
      - Authentication and authorization best practices

      Review the code for security issues and provide:
      1. Vulnerability description
      2. Attack scenario
      3. Recommended fix
      4. Severity rating (critical/high/medium/low)
  next: ["report"]
```

**Pattern 2: Output Format Specification**

```yaml
analyze:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
    systemPrompt: |
      Analyze the codebase and return findings in this JSON format:

      {
        "summary": "Brief overview",
        "issues": [
          {
            "type": "security|performance|maintainability",
            "severity": "critical|high|medium|low",
            "file": "path/to/file.ts",
            "line": 123,
            "description": "Issue description",
            "recommendation": "How to fix"
          }
        ],
        "metrics": {
          "totalFiles": 10,
          "totalLines": 5000,
          "issuesFound": 3
        }
      }

      Return ONLY valid JSON, no markdown formatting.
  next: ["process"]
```

**Pattern 3: Decision Tree Guidance**

```yaml
assess:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
    systemPrompt: |
      Assess the bug and choose the appropriate fix approach:

      Decision Tree:

      1. Is the bug in test code?
         YES → Transition to "fix_tests"
         NO → Continue to step 2

      2. Is the bug a simple typo (fix < 5 lines)?
         YES → Transition to "quick_fix"
         NO → Continue to step 3

      3. Does the fix require understanding multiple files?
         YES → Transition to "complex_fix"
         NO → Continue to step 4

      4. Is the bug in a critical path (auth, payments)?
         YES → Transition to "critical_fix"
         NO → Transition to "standard_fix"

      After assessment, transition to the appropriate state.
  next: ["fix_tests", "quick_fix", "complex_fix", "critical_fix", "standard_fix"]
```

**Pattern 4: Progressive Prompting**

```yaml
# Stage 1: Broad exploration
explore:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "code_search"]
    systemPrompt: |
      Explore the codebase to understand:
      1. Overall architecture
      2. Main components and their relationships
      3. Entry points and data flow

      Provide a high-level summary (2-3 paragraphs).
  next: ["deep_dive"]

# Stage 2: Focused analysis
deep_dive:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep", "semantic_search"]
    systemPrompt: |
      Based on the exploration summary, perform a deep dive on:
      1. Potential security vulnerabilities
      2. Performance bottlenecks
      3. Code quality issues

      For each issue, provide:
      - File path and line number
      - Detailed explanation
      - Recommended fix approach
  next: ["report"]
```

#### System Prompt Best Practices

**✅ DO:**

- Use clear, specific instructions
- Define constraints explicitly
- Provide examples and context
- Specify output format when needed
- Include decision logic for branching
- Iterate and refine based on results

**❌ DON'T:**

- Use vague instructions ("do a good job")
- Over-constrain (paralysis by analysis)
- Make prompts too long (loses focus)
- Ignore model capabilities
- Assume domain knowledge without context
- Use prompts that conflict with tool access

#### System Prompt Examples by Use Case

**Bug Fix:**

```yaml
fix_bug:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "edit", "bash"]
    systemPrompt: |
      Fix the bug described in the task. Approach:
      1. Understand the bug from error messages and code
      2. Identify root cause
      3. Implement minimal fix
      4. Verify fix addresses root cause, not symptoms

      Principles:
      - Fix the root cause, not workarounds
      - Minimal changes (prefer small edits)
      - Preserve existing behavior
      - Add tests if applicable
  next: ["verify"]
```

**Feature Implementation:**

```yaml
implement_feature:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write", "edit"]
    systemPrompt: |
      Implement the feature following:
      1. Project architecture patterns
      2. Existing code style and conventions
      3. Type safety and error handling

      Implementation checklist:
      - [ ] Feature works as specified
      - [ ] Error handling in place
      - [ ] Type definitions updated
      - [ ] Code follows project patterns
      - [ ] Documentation updated
  next: ["verify"]
```

**Refactoring:**

```yaml
refactor:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "edit"]
    systemPrompt: |
      Refactor to improve code quality while preserving behavior.

      Refactoring priorities:
      1. Improve readability (naming, structure)
      2. Reduce duplication (DRY principle)
      3. Simplify complex logic
      4. Better separation of concerns

      Constraints:
      - DO NOT change external interfaces
      - DO NOT alter behavior (verify with tests)
      - Make incremental changes (one improvement at a time)
  next: ["verify"]
```

**Documentation:**

```yaml
document:
  type: "agent"
  config:
    models: ["haiku"]
    tools: ["read", "write"]
    systemPrompt: |
      Create clear, concise documentation following:
      1. Project documentation style
      2. Markdown formatting standards
      3. Code examples where helpful

      Documentation guidelines:
      - Start with user's goal (not implementation details)
      - Provide concrete examples
      - Keep explanations brief and scannable
      - Include edge cases and gotchas
      - Link to related documentation
  next: ["done"]
```

### 13.4 Complete Agent Configuration Examples

**Example 1: Progressive Escalation Workflow**

```yaml
id: "progressive-escalation"
name: "Progressive Escalation"
description: "Starts fast, escalates model and tool access based on complexity"
triggerKeywords: ["fix", "bug", "error"]
priority: 100
initialState: "assess"

states:
  # Fast assessment with minimal tools
  assess:
    type: "agent"
    config:
      name: "quick_assessor"
      models: ["haiku"]
      tools: ["read", "grep"]
      systemPrompt: |
        Quickly assess the bug:
        1. What file is affected?
        2. Is it a simple fix (< 5 lines)?

        If simple → transition to "quick_fix"
        If complex → transition to "detailed_analysis"
    next: ["quick_fix", "detailed_analysis"]

  # Simple fix with restricted access
  quick_fix:
    type: "agent"
    config:
      name: "fixer"
      models: ["sonnet"]
      tools: ["read", "edit"]  # No bash - simple edits only
      systemPrompt: |
        Apply a quick fix (< 5 line changes).
        DO NOT run tests (will be done separately).
    next: ["verify"]

  # Deep analysis with full access
  detailed_analysis:
    type: "agent"
    config:
      name: "analyzer"
      models: ["claude-sonnet-4-6", "sonnet"]  # Best quality with fallback
      tools: ["read", "grep", "semantic_search"]  # Read-only
      systemPrompt: |
        Perform deep analysis:
        1. Root cause identification
        2. Impact assessment
        3. Fix strategy
        4. Risk evaluation

        Provide detailed analysis report.
    next: ["plan_fix"]

  # Planning with quality model
  plan_fix:
    type: "agent"
    config:
      name: "planner"
      models: ["sonnet"]
      tools: ["read", "write"]  # Can create plan files
      systemPrompt: |
        Create implementation plan:
        1. Step-by-step changes
        2. Files to modify
        3. Tests to add/update
        4. Rollback strategy
    next: ["implement"]

  # Implementation with fallback
  implement:
    type: "agent"
    config:
      name: "implementer"
      models: ["sonnet", "haiku"]  # Quality with cost fallback
      tools: ["read", "write", "edit", "bash"]  # Full access
      systemPrompt: |
        Implement the plan:
        1. Follow the plan step-by-step
        2. Make incremental changes
        3. Run tests after each change
        4. Roll back if tests fail
    next: ["verify"]

  verify:
    type: "deterministic"
    action: "run_tests"
    on:
      pass: ["done"]
      fail: ["implement"]  # Fix and retry

  done:
    type: "terminal"
```

**Example 2: Security Review with Role-Based Prompting**

```yaml
id: "security-review"
name: "Security Review Workflow"
description: "Security-focused code review with specialized prompts"
triggerKeywords: ["security", "audit", "vulnerability"]
priority: 100
initialState: "scan"

states:
  # Automated vulnerability scan
  scan:
    type: "agent"
    config:
      name: "scanner"
      models: ["haiku"]  # Fast scanning
      tools: ["grep", "read"]
      systemPrompt: |
        Scan for common vulnerability patterns:
        1. SQL injection: (query.*, execute.*, `.*$\{.*\}.*`)
        2. XSS: (innerHTML.*, insertAdjacentHTML.*)
        3. Hardcoded secrets: (api_key.*, password.*, secret.*=.*['"].*['"])
        4. Missing auth: (public.*, noAuth.*true)

        For each match, provide file path, line number, and severity.
    next: ["analyze"]

  # Deep security analysis
  analyze:
    type: "agent"
    config:
      name: "security_analyst"
      models: ["claude-sonnet-4-6"]  # Best reasoning for security
      tools: ["read", "grep", "semantic_search"]
      systemPrompt: |
        You are a security expert. Analyze the code for:
        1. Authentication and authorization flaws
        2. Input validation issues
        3. Cryptographic weaknesses
        4. Insecure data handling
        5. Dependency vulnerabilities

        For each vulnerability found:
        - Describe the attack scenario
        - Estimate exploitability (easy/medium/hard)
        - Assess impact (low/medium/high/critical)
        - Provide specific remediation steps
    next: ["report"]

  # Generate security report
  report:
    type: "agent"
    config:
      name: "reporter"
      models: ["sonnet"]
      tools: ["write"]
      systemPrompt: |
        Generate security report in markdown:

        # Security Review Report

        ## Executive Summary
        - Total vulnerabilities: X
        - Critical: X, High: X, Medium: X, Low: X

        ## Findings

        ### [CRITICAL/HIGH/MEDIUM/LOW] Vulnerability Name
        **Location:** `file.ts:123`
        **Exploitability:** Easy/Medium/Hard
        **Impact:** Low/Medium/High/Critical

        **Description:**
        [Detailed description]

        **Remediation:**
        [Specific fix steps]

        ## Recommendations
        [Prioritized action items]
    next: ["done"]

  done:
    type: "terminal"
```

**Example 3: Multi-Stage Documentation Generation**

```yaml
id: "docs-generator"
name: "Documentation Generator"
description: "Generate documentation with multiple refinement stages"
triggerKeywords: ["document", "docs", "readme"]
priority: 80
initialState: "outline"

states:
  # Create outline with fast model
  outline:
    type: "agent"
    config:
      name: "outliner"
      models: ["haiku"]  # Fast model for outline
      tools: ["read", "code_search"]
      systemPrompt: |
        Create documentation outline:
        1. Scan codebase to understand structure
        2. Identify key components and features
        3. Create hierarchical outline with sections

        Output structure:
        # Title
        ## Overview
        ## Installation
        ## Usage
        ## API Reference
        ## Examples
        ## Contributing
    next: ["draft"]

  # Write first draft with medium model
  draft:
    type: "agent"
    config:
      name: "drafter"
      models: ["sonnet"]  # Quality model for content
      tools: ["read", "write"]
      systemPrompt: |
        Write documentation based on outline:
        1. Follow the outline structure
        2. Write clear, concise explanations
        3. Include code examples
        4. Add practical use cases

        Writing style:
        - Start with user's goal
        - Provide concrete examples
        - Keep explanations brief
        - Use formatting for readability
    next: ["review"]

  # Review and refine with best model
  review:
    type: "agent"
    config:
      name: "refiner"
      models: ["claude-sonnet-4-6"]  # Best model for refinement
      tools: ["read", "edit"]
      systemPrompt: |
        Review and refine documentation:
        1. Check for clarity and completeness
        2. Verify accuracy of code examples
        3. Improve flow and readability
        4. Fix grammar and style issues
        5. Add missing information

        Focus on:
        - Is the explanation clear to newcomers?
        - Are examples accurate and runnable?
        - Is formatting consistent?
        - Are edge cases covered?
    next: ["format"]

  # Format and finalize
  format:
    type: "agent"
    config:
      name: "formatter"
      models: ["haiku"]  # Fast model for formatting
      tools: ["edit"]
      systemPrompt: |
        Final formatting pass:
        1. Ensure consistent heading levels
        2. Check code block syntax highlighting
        3. Verify link references
        4. Add table of contents if needed
    next: ["done"]

  done:
    type: "terminal"
```

### 13.5 Agent Configuration Checklist

When configuring agent states, verify:

**Models Array:**
- [ ] Models are ordered by priority (best first)
- [ ] Fallback models are appropriate for the task
- [ ] Cost/speed/quality tradeoffs are considered
- [ ] Model capabilities match task complexity

**Tool Allowlist:**
- [ ] Only necessary tools are included
- [ ] Read tools are included if write/edit tools are used
- [ ] Security risks are assessed (especially for `bash`)
- [ ] Tools match the task requirements

**System Prompt:**
- [ ] Instructions are specific and actionable
- [ ] Constraints are explicitly defined
- [ ] Examples and context are provided
- [ ] Output format is specified if needed
- [ ] Decision logic is clear for branching states
- [ ] Role is defined if using specialized prompting

---

## Additional Resources

- **Examples:** `.blueprints/examples/` - Example blueprint YAML files
- **Source Code:** `src/blueprints/` - Blueprint implementation
- **Stripe Minions:** [Original inspiration](https://stripe.com/blog/minions)
- **LangGraph:** [State graph documentation](https://langchain-ai.github.io/langgraph/)

---

**Last Updated:** 2025-04-26
