# Blueprint Examples Documentation

This directory contains comprehensive documentation and examples for the Bullhorse blueprint system. Blueprints define state machine workflows that intermix agent nodes (LLM-powered reasoning) and deterministic nodes (shell commands, validation, etc.).

## Table of Contents

1. [Blueprint Basics](#1-blueprint-basics) - Core concepts and structure
2. [Default Blueprint](#2-default-blueprint) - Simple single-agent workflow
3. [Bug Fix Blueprint](#3-bug-fix-blueprint) - Full debugging with verification loop
4. [Feature Blueprint](#4-feature-blueprint) - Feature implementation with testing
5. [Refactor Blueprint](#5-refactor-blueprint) - Code restructuring workflow
6. [Test Blueprint](#6-test-blueprint) - Test addition workflow
7. [Docs Blueprint](#7-docs-blueprint) - Documentation changes
8. [Chore Blueprint](#8-chore-blueprint) - Maintenance tasks
9. [Creating Custom Blueprints](#9-creating-custom-blueprints) - How to write your own

---

## 1. Blueprint Basics

### What is a Blueprint?

A blueprint is a YAML-defined state machine that specifies:
- **States**: Steps in the workflow (agent tasks, tests, linters, etc.)
- **Transitions**: How to move between states based on outcomes
- **Configuration**: Models, tools, and prompts for each state
- **Triggers**: Keywords that automatically select the blueprint

### Blueprint Structure

```yaml
id: "blueprint-id"           # Unique identifier
name: "Display Name"         # Human-readable name
description: "What it does"  # Description
triggerKeywords: ["fix"]     # Auto-trigger keywords
priority: 100                # Higher = selected first
initialState: "start"        # Entry point state

states:
  state_name:                # State identifier
    type: "agent"            # State type: agent/deterministic/terminal
    config:                  # Agent-specific config
      models: ["sonnet"]     # Models to use
      tools: ["read"]        # Available tools
      systemPrompt: "..."    # Agent instructions
    next: ["next_state"]     # Next state(s)
    on:                      # Conditional transitions (deterministic only)
      pass: ["success_state"]
      fail: ["retry_state"]
```

### State Types

| Type | Description | Use Case |
|------|-------------|----------|
| **agent** | LLM-powered reasoning | Code generation, analysis, planning |
| **deterministic** | Shell commands | Tests, linters, Git operations |
| **terminal** | End of workflow | Success/final state |

### Deterministic Actions

| Action | Description | Exit Codes |
|--------|-------------|------------|
| `run_linters` | Run TypeScript linter | 0 = pass, non-zero = fail |
| `run_tests` | Execute test suite | 0 = pass, non-zero = fail |
| `create_pr` | Create pull request | Always passes |

### Model Selection

Available models (configure via `MODEL` env var):
- `haiku` - Fast, inexpensive (exploration, simple tasks)
- `sonnet` - Balanced (most work)
- `claude-sonnet-4-6` - High quality (planning, complex tasks)

---

## 2. Default Blueprint

**File:** `.blueprints/default.yaml`

### Overview

The default blueprint is a minimal single-agent workflow for general tasks that don't fit into specific categories. It provides a straightforward implementation workflow without testing or verification.

### When It's Used

- No other blueprint matches the task
- General maintenance tasks
- Simple code changes
- Exploration and investigation

### Workflow Diagram

```
┌─────────────┐
│  implement  │  Agent node with full tool access
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    done     │  Terminal state
└─────────────┘
```

### Blueprint Code

```yaml
id: "default"
name: "Default"
description: "Default blueprint for general tasks"
triggerKeywords: []
priority: 0
initialState: "implement"

states:
  implement:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6"]
      tools: ["read", "write", "edit", "code_search", "grep"]
      systemPrompt: "Complete the task."
    next: ["done"]

  done:
    type: "terminal"
```

### Use Cases

| Scenario | Example |
|----------|---------|
| General investigation | "Find where the auth middleware is defined" |
| Simple code changes | "Update the copyright headers" |
| Documentation updates | "Add a comment explaining this function" |
| File exploration | "List all test files in the project" |

---

## 3. Bug Fix Blueprint

**File:** `.blueprints/bug-fix.yaml`

### Overview

The bug fix blueprint provides a comprehensive debugging workflow with exploration, planning, implementation, and verification loops. It's designed to systematically identify root causes and validate fixes.

### When It's Used

Triggered by keywords: `fix`, `bug`, `error`, `broken`, `not working`, `issue`

### Workflow Diagram

```
         ┌─────────────┐
         │   explore   │  Haiku: Find root cause
         └──────┬──────┘
                │
                ▼
         ┌─────────────┐
         │    plan     │  Plan the fix
         └──────┬──────┘
                │
                ▼
         ┌─────────────┐
         │  implement  │  Implement the fix
         └──────┬──────┘
                │
                ▼
         ┌─────────────┐
         │    lint     │  Run linters ◄────┐
         └──────┬──────┘                  │
                │                         │
        ┌───────┴───────┐                 │
        │               │                 │
     pass              fail              │
        │               │                 │
        ▼               ▼                 │
    ┌────────┐    ┌──────────┐            │
    │  test  │    │ fix_lint │────────────┘
    └───┬────┘    └──────────┘
        │
   ┌────┴────┐
   │         │
 pass       fail
   │         │
   ▼         ▼
┌─────────┐ ┌──────────┐
│create_pr│ │ fix_test │──┐
└────┬────┘ └──────────┘  │
     │                   │
     └───────────────────┘
            │
            ▼
     ┌─────────────┐
     │    done     │
     └─────────────┘
```

### Blueprint Code

```yaml
id: "bug-fix"
name: "Bug Fix"
description: "For fixing bugs and errors"
triggerKeywords: ["fix", "bug", "error", "broken", "not working", "issue"]
priority: 100
initialState: "explore"

states:
  explore:
    type: "agent"
    config:
      models: ["haiku"]
      tools: ["code_search", "semantic_search", "read"]
      systemPrompt: "Find the root cause of the bug."
    next: ["plan"]

  plan:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6", "haiku"]
      tools: ["read", "grep"]
      systemPrompt: "Plan the bug fix."
    next: ["implement"]

  implement:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6", "sonnet"]
      tools: ["edit", "write", "read", "code_search"]
      systemPrompt: "Implement the bug fix."
    next: ["lint"]

  lint:
    type: "deterministic"
    action: "run_linters"
    on:
      pass: ["test"]
      fail: ["fix_lint"]

  fix_lint:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix the lint errors."
    next: ["lint"]

  test:
    type: "deterministic"
    action: "run_tests"
    on:
      pass: ["create_pr"]
      fail: ["fix_test"]

  fix_test:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix the failing tests."
    next: ["test"]

  create_pr:
    type: "deterministic"
    action: "create_pr"
    next: ["done"]

  done:
    type: "terminal"
```

### Key Features

| Feature | Purpose |
|---------|---------|
| **Explore phase** | Fast root cause discovery with Haiku |
| **Verification loop** | Lint → Test → Fix cycle ensures quality |
| **Automatic PR creation** | Creates pull request when tests pass |
| **Retry loops** | Automatic fixing of lint and test failures |

### Use Cases

| Scenario | Example Prompt |
|----------|----------------|
| Runtime errors | "Fix the TypeError in user authentication" |
| Test failures | "Tests are failing in the checkout flow" |
| Logic bugs | "The discount calculation is wrong" |
| Performance issues | "This query is too slow, fix it" |

---

## 4. Feature Blueprint

**File:** `.blueprints/feature.yaml`

### Overview

The feature blueprint implements new functionality with planning, implementation, and verification. It balances speed with quality through targeted model selection.

### When It's Used

Triggered by keywords: `implement`, `add`, `feature`, `create`, `new`

### Workflow Diagram

```
┌─────────────┐
│    plan     │  Plan the feature
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  implement  │  Implement the feature
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    lint     │  Run linters ◄────┐
└──────┬──────┘                  │
       │                         │
┌──────┴───────┐                 │
│              │                 │
pass          fail               │
│              │                 │
▼              ▼                 │
┌────────┐  ┌──────────┐         │
│  test  │  │ fix_lint │─────────┘
└───┬────┘  └──────────┘
    │
┌───┴────┐
│        │
pass    fail
│        │
▼        ▼
┌─────────┐ ┌──────────┐
│create_pr│ │ fix_test │──┐
└────┬────┘ └──────────┘  │
     │                   │
     └───────────────────┘
          │
          ▼
    ┌─────────────┐
    │    done     │
    └─────────────┘
```

### Blueprint Code

```yaml
id: "feature"
name: "Feature Implementation"
description: "For implementing new features"
triggerKeywords: ["implement", "add", "feature", "create", "new"]
priority: 90
initialState: "plan"

states:
  plan:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6"]
      tools: ["read", "grep", "code_search"]
      systemPrompt: "Plan the feature implementation."
    next: ["implement"]

  implement:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6", "sonnet"]
      tools: ["edit", "write", "read", "code_search"]
      systemPrompt: "Implement the feature."
    next: ["lint"]

  lint:
    type: "deterministic"
    action: "run_linters"
    on:
      pass: ["test"]
      fail: ["fix_lint"]

  fix_lint:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix lint errors."
    next: ["lint"]

  test:
    type: "deterministic"
    action: "run_tests"
    on:
      pass: ["create_pr"]
      fail: ["fix_test"]

  fix_test:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix failing tests."
    next: ["test"]

  create_pr:
    type: "deterministic"
    action: "create_pr"
    next: ["done"]

  done:
    type: "terminal"
```

### Key Features

| Feature | Purpose |
|---------|---------|
| **Planning phase** | High-quality planning before implementation |
| **Multi-model implementation** | Claude Sonnet for reasoning, Sonnet for code |
| **Verification loop** | Ensures code quality and test coverage |
| **PR automation** | Creates pull request automatically |

### Use Cases

| Scenario | Example Prompt |
|----------|----------------|
| New endpoints | "Add a POST endpoint for creating orders" |
| UI components | "Implement a user profile card component" |
| Database features | "Add soft delete to all models" |
| Integrations | "Integrate with Stripe for payments" |

---

## 5. Refactor Blueprint

**File:** `.blueprints/refactor.yaml`

### Overview

The refactor blueprint handles code restructuring with analysis, planning, and verification. It emphasizes maintaining functionality while improving code quality.

### When It's Used

Triggered by keywords: `refactor`, `restructure`, `reorganize`, `clean up`

### Workflow Diagram

```
┌─────────────┐
│   analyze   │  Analyze current code
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    plan     │  Plan refactoring approach
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  implement  │  Implement refactoring
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    lint     │  Run linters ◄────┐
└──────┬──────┘                  │
       │                         │
┌──────┴───────┐                 │
│              │                 │
pass          fail               │
│              │                 │
▼              ▼                 │
┌────────┐  ┌──────────┐         │
│  test  │  │ fix_lint │─────────┘
└───┬────┘  └──────────┘
    │
┌───┴────┐
│        │
pass    fail
│        │
▼        ▼
┌─────────┐ ┌──────────┐
│create_pr│ │ fix_test │──┐
└────┬────┘ └──────────┘  │
     │                   │
     └───────────────────┘
          │
          ▼
    ┌─────────────┐
    │    done     │
    └─────────────┘
```

### Blueprint Code

```yaml
id: "refactor"
name: "Refactor"
description: "For code restructuring and cleanup"
triggerKeywords: ["refactor", "restructure", "reorganize", "clean up"]
priority: 80
initialState: "analyze"

states:
  analyze:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["read", "grep", "code_search"]
      systemPrompt: "Analyze the code to understand the current structure."
    next: ["plan"]

  plan:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6"]
      tools: ["read", "grep"]
      systemPrompt: "Plan the refactoring approach. Ensure no behavior changes."
    next: ["implement"]

  implement:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Implement the refactoring."
    next: ["lint"]

  lint:
    type: "deterministic"
    action: "run_linters"
    on:
      pass: ["test"]
      fail: ["fix_lint"]

  fix_lint:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix lint errors."
    next: ["lint"]

  test:
    type: "deterministic"
    action: "run_tests"
    on:
      pass: ["create_pr"]
      fail: ["fix_test"]

  fix_test:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix failing tests."
    next: ["test"]

  create_pr:
    type: "deterministic"
    action: "create_pr"
    next: ["done"]

  done:
    type: "terminal"
```

### Key Features

| Feature | Purpose |
|---------|---------|
| **Analysis phase** | Understand current structure before changing |
| **Behavior preservation** | Tests ensure refactoring doesn't break functionality |
| **Incremental verification** | Lint and test at each step |

### Use Cases

| Scenario | Example Prompt |
|----------|----------------|
| Code organization | "Refactor the utils module into smaller files" |
| Design patterns | "Convert to factory pattern for user creation" |
| Dependencies | "Remove circular dependencies in services" |
| Naming | "Rename all variables to be more descriptive" |

---

## 6. Test Blueprint

**File:** `.blueprints/test.yaml`

### Overview

The test blueprint focuses on adding test coverage with implementation and verification. It's optimized for writing comprehensive tests efficiently.

### When It's Used

Triggered by keywords: `test`, `spec`, `coverage`

### Workflow Diagram

```
┌─────────────┐
│  implement  │  Write comprehensive tests
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  run_test   │  Run tests ◄────┐
└──────┬──────┘                │
       │                       │
┌──────┴───────┐               │
│              │               │
pass          fail             │
│              │               │
▼              ▼               │
┌─────────┐  ┌──────────┐      │
│create_pr│ │ fix_test │──────┘
└────┬────┘ └──────────┘
     │
     ▼
┌─────────────┐
│    done     │
└─────────────┘
```

### Blueprint Code

```yaml
id: "test"
name: "Test Addition"
description: "For adding tests"
triggerKeywords: ["test", "spec", "coverage"]
priority: 70
initialState: "implement"

states:
  implement:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["write", "read", "code_search"]
      systemPrompt: "Write comprehensive tests."
    next: ["run_test"]

  run_test:
    type: "deterministic"
    action: "run_tests"
    on:
      pass: ["create_pr"]
      fail: ["fix_test"]

  fix_test:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix failing tests."
    next: ["run_test"]

  create_pr:
    type: "deterministic"
    action: "create_pr"
    next: ["done"]

  done:
    type: "terminal"
```

### Key Features

| Feature | Purpose |
|---------|---------|
| **Test-focused prompt** | Optimized for writing comprehensive tests |
| **Quick verification** | Run tests immediately after writing |
| **Single loop** | Simple test → fix → test cycle |

### Use Cases

| Scenario | Example Prompt |
|----------|----------------|
| Unit tests | "Add unit tests for the UserService" |
| Integration tests | "Write integration tests for the checkout flow" |
| Coverage gaps | "Increase test coverage to 80% in auth module" |
| Edge cases | "Add tests for all error conditions" |

---

## 7. Docs Blueprint

**File:** `.blueprints/docs.yaml`

### Overview

The docs blueprint handles documentation changes with a simple write-and-review workflow. It's designed for quick documentation updates without extensive testing.

### When It's Used

Triggered by keywords: `document`, `docs`, `readme`, `comment`

### Workflow Diagram

```
┌─────────────┐
│  implement  │  Write or update documentation
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    done     │
└─────────────┘
```

### Blueprint Code

```yaml
id: "docs"
name: "Documentation"
description: "For documentation changes"
triggerKeywords: ["document", "docs", "readme", "comment"]
priority: 50
initialState: "implement"

states:
  implement:
    type: "agent"
    config:
      models: ["haiku"]
      tools: ["write", "read", "edit"]
      systemPrompt: "Write or update documentation."
    next: ["done"]

  done:
    type: "terminal"
```

### Key Features

| Feature | Purpose |
|---------|---------|
| **Fast model** | Uses Haiku for quick documentation |
| **Simple workflow** | No testing or linting for docs |
| **Read/write focus** | Optimized for documentation tools |

### Use Cases

| Scenario | Example Prompt |
|----------|----------------|
| README updates | "Update the README with new features" |
| API docs | "Document the new API endpoints" |
| Code comments | "Add JSDoc comments to all public methods" |
| Guides | "Write a getting started guide" |

---

## 8. Chore Blueprint

**File:** `.blueprints/chore.yaml`

### Overview

The chore blueprint handles maintenance tasks that don't require extensive planning or testing. It's optimized for quick, routine changes.

### When It's Used

Triggered by keywords: `chore`, `update`, `upgrade`, `maintenance`

### Workflow Diagram

```
┌─────────────┐
│  implement  │  Implement the chore task
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    done     │
└─────────────┘
```

### Blueprint Code

```yaml
id: "chore"
name: "Chore"
description: "For maintenance tasks"
triggerKeywords: ["chore", "update", "upgrade", "maintenance"]
priority: 40
initialState: "implement"

states:
  implement:
    type: "agent"
    config:
      models: ["haiku"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Implement the chore task."
    next: ["done"]

  done:
    type: "terminal"
```

### Key Features

| Feature | Purpose |
|---------|---------|
| **Fast execution** | Uses Haiku for quick completion |
| **Minimal workflow** | No testing for routine tasks |
| **Essential tools** | Edit, write, read for simple changes |

### Use Cases

| Scenario | Example Prompt |
|----------|----------------|
| Dependency updates | "Update all dependencies to latest versions" |
| Config changes | "Update the ESLint configuration" |
| File cleanup | "Remove all unused files" |
| Metadata | "Update package.json metadata" |

---

## 9. Creating Custom Blueprints

### Blueprint File Location

Custom blueprints should be placed in:
```
.blueprints/custom/your-blueprint.yaml
```

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

### Blueprint Design Guidelines

#### 1. **Choose the Right States**

| Need | Use State Type |
|------|----------------|
| LLM reasoning/planning | `agent` |
| Running tests/linters | `deterministic` |
| Workflow completion | `terminal` |

#### 2. **Model Selection Strategy**

| Task | Recommended Model |
|------|-------------------|
| Fast exploration | `haiku` |
| Code implementation | `sonnet` |
| Complex planning | `claude-sonnet-4-6` |

#### 3. **Tool Selection**

Available tools:
- **File operations**: `read`, `write`, `edit`
- **Search**: `code_search`, `grep`, `semantic_search`
- **Execution**: `bash` (for running commands)

#### 4. **Error Handling Loops**

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

### Advanced Patterns

#### Multi-Agent Planning

```yaml
plan:
  type: "agent"
  config:
    models: ["claude-sonnet-4-6", "haiku"]
    tools: ["read", "grep", "code_search"]
    systemPrompt: "Create a detailed implementation plan."
  next: ["review"]

review:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read"]
    systemPrompt: "Review the plan for completeness."
  next: ["implement"]
```

#### Conditional Branching

```yaml
analyze:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "grep"]
    systemPrompt: "Analyze and determine the approach."
  # Agent chooses next state dynamically
```

#### Parallel Workflows

While blueprints are currently linear, you can design states that handle multiple paths:

```yaml
assess:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read"]
    systemPrompt: "Assess the situation and choose the appropriate path."
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

### Testing Your Blueprint

1. **Create the blueprint file** in `.blueprints/custom/`
2. **Test locally:**
   ```typescript
   import { loadBlueprints, selectBlueprint } from './blueprints';

   const blueprints = await loadBlueprints();
   const task = "Fix the login bug";  // Your test task
   const selection = selectBlueprint(task, blueprints);

   console.log(`Selected: ${selection.blueprint.name}`);
   console.log(`Reason: ${selection.reason}`);
   ```
3. **Verify workflow:** Run through the state machine manually
4. **Test edge cases:** Try different task descriptions
5. **Adjust keywords:** Ensure proper blueprint selection

### Blueprint Selection Priority

Higher priority blueprints are selected first. Default priorities:

| Blueprint | Priority |
|-----------|----------|
| Bug Fix | 100 |
| Feature | 90 |
| Refactor | 80 |
| Test | 70 |
| Docs | 50 |
| Chore | 40 |
| Default | 0 |

### Best Practices

1. **Keep blueprints focused** - One primary purpose per blueprint
2. **Use specific keywords** - Avoid overlap between blueprints
3. **Set appropriate priorities** - More specific = higher priority
4. **Include verification** - Add test/lint states for quality
5. **Write clear system prompts** - Guide the agent effectively
6. **Handle failures** - Always provide fix/ retry paths
7. **Test thoroughly** - Verify workflow before production use

### Example: Custom CI/CD Blueprint

```yaml
id: "ci-cd"
name: "CI/CD Pipeline"
description: "For CI/CD pipeline configuration"
triggerKeywords: ["pipeline", "ci", "cd", "deploy", "workflow"]
priority: 85
initialState: "analyze"

states:
  analyze:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["read", "grep"]
      systemPrompt: "Analyze the current CI/CD setup and requirements."
    next: ["plan"]

  plan:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6"]
      tools: ["read", "code_search"]
      systemPrompt: "Plan the CI/CD pipeline configuration."
    next: ["implement"]

  implement:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["write", "edit"]
      systemPrompt: "Implement the CI/CD pipeline configuration."
    next: ["validate"]

  validate:
    type: "deterministic"
    action: "run_linters"
    on:
      pass: ["done"]
      fail: ["fix"]

  fix:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "read"]
      systemPrompt: "Fix validation errors."
    next: ["validate"]

  done:
    type: "terminal"
```

---

## Quick Reference

### Blueprint Selection Matrix

| Task Type | Use Blueprint | Keywords |
|-----------|---------------|----------|
| Bug fixing | `bug-fix` | fix, bug, error, broken |
| New features | `feature` | implement, add, feature, create |
| Code cleanup | `refactor` | refactor, restructure, clean up |
| Adding tests | `test` | test, spec, coverage |
| Documentation | `docs` | document, docs, readme |
| Maintenance | `chore` | chore, update, maintenance |
| Everything else | `default` | (none) |

### Common State Configurations

```yaml
# Simple agent state
simple:
  type: "agent"
  config:
    models: ["sonnet"]
    tools: ["read", "write"]
    systemPrompt: "Do the work"
  next: ["done"]

# Verification loop
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
    systemPrompt: "Fix the issues"
  next: ["verify"]
```

### Model Selection Guide

| Model | Speed | Cost | Quality | Best For |
|-------|-------|------|---------|----------|
| `haiku` | Fast | Low | Good | Exploration, simple tasks |
| `sonnet` | Medium | Medium | High | Most code work |
| `claude-sonnet-4-6` | Slower | Higher | Best | Planning, complex tasks |

---

## Additional Resources

- **Main README:** Project overview and setup
- **Source Code:** `src/blueprints/` - Blueprint loading and compilation
- **Examples:** See all blueprint files in `.blueprints/`
- **Issues:** Report problems or request features

---

**Last Updated:** 2025-04-26
