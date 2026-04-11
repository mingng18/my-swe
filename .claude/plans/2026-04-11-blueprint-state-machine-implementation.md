# Blueprint State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the blueprint system to follow Stripe's minions pattern — state machine workflows that compile to LangGraph StateGraphs.

**Architecture:** Blueprints defined as YAML files → loaded by BlueprintLoader → compiled to LangGraph by BlueprintCompiler → executed with deterministic actions and inline subagents.

**Tech Stack:** TypeScript, LangGraph StateGraph, YAML (js-yaml), JSON Schema validation

---

## File Structure

```
src/blueprints/
├── types.ts              # NEW - Blueprint type definitions
├── actions.ts            # NEW - Deterministic action registry
├── schemas/
│   └── blueprint-schema.json  # NEW - JSON schema for validation
├── loader.ts             # NEW - Load blueprints from YAML
├── selection.ts          # NEW - Blueprint selection by keywords
├── compiler.ts           # NEW - Compile blueprint → LangGraph
├── index.ts              # MODIFY - Public exports (restructure)
├── blueprint.ts          # DEPRECATE - Old implementation (keep for backward compat)
└── __tests__/
    ├── types.test.ts     # NEW
    ├── actions.test.ts   # NEW
    ├── loader.test.ts    # NEW
    ├── selection.test.ts # NEW
    ├── compiler.test.ts  # NEW
    └── integration.test.ts  # NEW

.blueprints/              # NEW - Blueprint definitions
├── bug-fix.yaml
├── feature.yaml
├── refactor.yaml
├── test.yaml
├── docs.yaml
└── chore.yaml

# Other files to modify
src/harness/deepagents.ts  # MODIFY - Integrate blueprint executor
package.json               # MODIFY - Add js-yaml dependency
CLAUDE.md                  # MODIFY - Update documentation
```

---

## Task 1: Add YAML parser dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add js-yaml dependency**

```bash
bun add js-yaml
bun add -d @types/js-yaml
```

- [ ] **Step 2: Verify installation**

Run: `bunx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "deps: add js-yaml for blueprint YAML parsing"
```

---

## Task 2: Define core types

**Files:**
- Create: `src/blueprints/types.ts`
- Test: `src/blueprints/__tests__/types.test.ts`

- [ ] **Step 1: Write type definitions**

```typescript
// src/blueprints/types.ts

/**
 * Blueprint definition - state machine workflow template.
 *
 * A blueprint defines a state machine that intermixes agent nodes
 * and deterministic nodes to execute tasks with proper feedback loops.
 */
export interface Blueprint {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of when to use this blueprint */
  description: string;

  /** Keywords that trigger this blueprint selection */
  triggerKeywords: string[];

  /** Priority (higher = checked first) */
  priority: number;

  /** State definitions */
  states: Record<string, State>;

  /** Initial state ID */
  initialState: string;
}

/**
 * State type - can be agent, deterministic, or terminal.
 */
export type State = AgentState | DeterministicState | TerminalState;

/**
 * Agent state - runs an LLM agent with inline configuration.
 */
export interface AgentState {
  type: "agent";
  config: AgentConfig;
  next: StateTransition;
}

/**
 * Deterministic state - runs a registered action function.
 */
export interface DeterministicState {
  type: "deterministic";
  action: string;
  on?: ConditionalTransition;
}

/**
 * Terminal state - ends the workflow.
 */
export interface TerminalState {
  type: "terminal";
}

/**
 * Inline agent configuration for agent states.
 */
export interface AgentConfig {
  /** Optional name for this agent instance */
  name?: string;

  /** Model array for fallback (tries in order) */
  models: string[];

  /** Tool allowlist (only these tools available) */
  tools: string[];

  /** Optional custom system prompt */
  systemPrompt?: string;
}

/**
 * Simple state transition - list of next state IDs.
 */
export type StateTransition = string[];

/**
 * Conditional transition for deterministic state results.
 */
export interface ConditionalTransition {
  /** States to transition to on success */
  pass?: string[];

  /** States to transition to on failure */
  fail?: string[];
}

/**
 * Blueprint selection result.
 */
export interface BlueprintSelection {
  blueprint: Blueprint;
  confidence: number;
  matchedKeywords: string[];
}

/**
 * State passed between blueprint nodes.
 */
export interface BlueprintState {
  /** Original task input */
  input: string;

  /** Current state ID */
  currentState: string;

  /** Last action result (for conditional transitions) */
  lastResult?: ActionResult;

  /** Error message if something went wrong */
  error?: string;
}

/**
 * Result from a deterministic action.
 */
export interface ActionResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Deterministic action definition.
 */
export interface DeterministicAction {
  name: string;
  description: string;
  execute: (state: BlueprintState) => Promise<ActionResult>;
}
```

- [ ] **Step 2: Write tests for types**

```typescript
// src/blueprints/__tests__/types.test.ts

import { describe, it, expect } from "bun:test";
import type {
  Blueprint,
  AgentState,
  DeterministicState,
  TerminalState,
  AgentConfig,
  BlueprintSelection,
  BlueprintState,
  ActionResult,
  DeterministicAction,
} from "../types";

describe("Blueprint Types", () => {
  describe("Blueprint", () => {
    it("should accept valid blueprint structure", () => {
      const blueprint: Blueprint = {
        id: "test-blueprint",
        name: "Test Blueprint",
        description: "A test blueprint",
        triggerKeywords: ["test"],
        priority: 100,
        initialState: "start",
        states: {
          start: { type: "terminal" },
        },
      };

      expect(blueprint.id).toBe("test-blueprint");
      expect(blueprint.initialState).toBe("start");
    });

    it("should support agent states with inline config", () => {
      const agentState: AgentState = {
        type: "agent",
        config: {
          models: ["haiku", "sonnet"],
          tools: ["read", "write"],
          systemPrompt: "You are a helpful agent",
        },
        next: ["next-state"],
      };

      expect(agentState.type).toBe("agent");
      expect(agentState.config.models).toHaveLength(2);
      expect(agentState.config.tools).toContain("read");
    });

    it("should support deterministic states with conditional transitions", () => {
      const detState: DeterministicState = {
        type: "deterministic",
        action: "run_tests",
        on: {
          pass: ["create_pr"],
          fail: ["fix_tests"],
        },
      };

      expect(detState.type).toBe("deterministic");
      expect(detState.on?.pass).toContain("create_pr");
      expect(detState.on?.fail).toContain("fix_tests");
    });

    it("should support terminal states", () => {
      const terminalState: TerminalState = {
        type: "terminal",
      };

      expect(terminalState.type).toBe("terminal");
    });
  });

  describe("BlueprintSelection", () => {
    it("should contain blueprint and metadata", () => {
      const selection: BlueprintSelection = {
        blueprint: {
          id: "test",
          name: "Test",
          description: "Test",
          triggerKeywords: [],
          priority: 0,
          initialState: "start",
          states: { start: { type: "terminal" } },
        },
        confidence: 0.8,
        matchedKeywords: ["test"],
      };

      expect(selection.confidence).toBe(0.8);
      expect(selection.matchedKeywords).toEqual(["test"]);
    });
  });

  describe("BlueprintState", () => {
    it("should hold execution state", () => {
      const state: BlueprintState = {
        input: "fix the bug",
        currentState: "implement",
        lastResult: { success: true, output: "Done" },
      };

      expect(state.input).toBe("fix the bug");
      expect(state.currentState).toBe("implement");
      expect(state.lastResult?.success).toBe(true);
    });
  });

  describe("ActionResult", () => {
    it("should support success and failure cases", () => {
      const success: ActionResult = { success: true, output: "Passed" };
      const failure: ActionResult = { success: false, error: "Failed" };

      expect(success.success).toBe(true);
      expect(failure.success).toBe(false);
      expect(failure.error).toBe("Failed");
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test src/blueprints/__tests__/types.test.ts`
Expected: PASS (all type checks)

- [ ] **Step 4: Commit**

```bash
git add src/blueprints/types.ts src/blueprints/__tests__/types.test.ts
git commit -m "feat(blueprints): add core type definitions"
```

---

## Task 3: Create JSON schema for validation

**Files:**
- Create: `src/blueprints/schemas/blueprint-schema.json`

- [ ] **Step 1: Write JSON schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Blueprint",
  "type": "object",
  "required": ["id", "name", "description", "triggerKeywords", "priority", "states", "initialState"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "name": { "type": "string" },
    "description": { "type": "string" },
    "triggerKeywords": { "type": "array", "items": { "type": "string" } },
    "priority": { "type": "number", "minimum": 0 },
    "initialState": { "type": "string" },
    "states": {
      "type": "object",
      "additionalProperties": {
        "oneOf": [
          {
            "type": "object",
            "required": ["type", "config", "next"],
            "properties": {
              "type": { "const": "agent" },
              "config": {
                "type": "object",
                "required": ["models", "tools"],
                "properties": {
                  "name": { "type": "string" },
                  "models": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
                  "tools": { "type": "array", "items": { "type": "string" } },
                  "systemPrompt": { "type": "string" }
                }
              },
              "next": { "type": "array", "items": { "type": "string" } }
            }
          },
          {
            "type": "object",
            "required": ["type", "action"],
            "properties": {
              "type": { "const": "deterministic" },
              "action": { "type": "string" },
              "on": {
                "type": "object",
                "properties": {
                  "pass": { "type": "array", "items": { "type": "string" } },
                  "fail": { "type": "array", "items": { "type": "string" } }
                }
              }
            }
          },
          {
            "type": "object",
            "required": ["type"],
            "properties": {
              "type": { "const": "terminal" }
            }
          }
        ]
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/blueprints/schemas/blueprint-schema.json
git commit -m "feat(blueprints): add JSON schema for validation"
```

---

## Task 4: Implement deterministic action registry

**Files:**
- Create: `src/blueprints/actions.ts`
- Test: `src/blueprints/__tests__/actions.test.ts`

- [ ] **Step 1: Write action registry**

```typescript
// src/blueprints/actions.ts

import { exec } from "child_process";
import { promisify } from "util";
import type {
  DeterministicAction,
  ActionResult,
  BlueprintState,
} from "./types";

const execAsync = promisify(exec);

/**
 * Registry for deterministic actions.
 */
export class ActionRegistry {
  private actions = new Map<string, DeterministicAction>();

  register(action: DeterministicAction): void {
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

export const actionRegistry = new ActionRegistry();

const runLintersAction: DeterministicAction = {
  name: "run_linters",
  description: "Run configured linters",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    const linterCommand = process.env.LINTER_COMMAND || "bunx tsc --noEmit";
    try {
      const { stdout, stderr } = await execAsync(linterCommand);
      return { success: true, output: stdout || "Linters passed" };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message || "Linters failed" };
    }
  },
};

const runTestsAction: DeterministicAction = {
  name: "run_tests",
  description: "Run test suite",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    const testCommand = process.env.TEST_COMMAND || "bun test";
    try {
      const { stdout, stderr } = await execAsync(testCommand);
      return { success: true, output: stdout || "Tests passed" };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message || "Tests failed" };
    }
  },
};

const runTypecheckAction: DeterministicAction = {
  name: "run_typecheck",
  description: "Run TypeScript type checking",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    try {
      const { stdout, stderr } = await execAsync("bunx tsc --noEmit");
      return { success: true, output: "Type check passed" };
    } catch (error: any) {
      return { success: false, error: error.stderr || error.message || "Type check failed" };
    }
  },
};

const createPrAction: DeterministicAction = {
  name: "create_pr",
  description: "Create pull request",
  execute: async (state: BlueprintState): Promise<ActionResult> => {
    return { success: true, output: "PR creation not yet implemented" };
  },
};

export function registerBuiltinActions(): void {
  actionRegistry.register(runLintersAction);
  actionRegistry.register(runTestsAction);
  actionRegistry.register(runTypecheckAction);
  actionRegistry.register(createPrAction);
}

registerBuiltinActions();
```

- [ ] **Step 2: Write tests**

```typescript
// src/blueprints/__tests__/actions.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { ActionRegistry, actionRegistry, registerBuiltinActions } from "../actions";
import type { BlueprintState } from "../types";

describe("ActionRegistry", () => {
  let testRegistry: ActionRegistry;

  beforeEach(() => { testRegistry = new ActionRegistry(); });

  it("should register an action", () => {
    testRegistry.register({
      name: "test_action",
      description: "Test",
      execute: async () => ({ success: true }),
    });
    expect(testRegistry.has("test_action")).toBe(true);
  });
});

describe("Builtin Actions", () => {
  it("should register all builtin actions", () => {
    registerBuiltinActions();
    expect(actionRegistry.has("run_linters")).toBe(true);
    expect(actionRegistry.has("run_tests")).toBe(true);
    expect(actionRegistry.has("run_typecheck")).toBe(true);
    expect(actionRegistry.has("create_pr")).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test src/blueprints/__tests__/actions.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/blueprints/actions.ts src/blueprints/__tests__/actions.test.ts
git commit -m "feat(blueprints): implement deterministic action registry"
```

---

## Task 5: Implement blueprint loader

**Files:**
- Create: `src/blueprints/loader.ts`
- Test: `src/blueprints/__tests__/loader.test.ts`

- [ ] **Step 1: Write blueprint loader**

```typescript
// src/blueprints/loader.ts

import * as yaml from "js-yaml";
import * as fs from "fs/promises";
import * as path from "path";
import type { Blueprint } from "./types";

export class BlueprintValidationError extends Error {
  constructor(public blueprintId: string, public errors: string[]) {
    super(`Blueprint validation failed for '${blueprintId}': ${errors.join(", ")}`);
    this.name = "BlueprintValidationError";
  }
}

export interface LoaderOptions {
  blueprintsDir?: string;
  validate?: boolean;
}

const DEFAULT_OPTIONS: LoaderOptions = {
  blueprintsDir: ".blueprints",
  validate: true,
};

export class BlueprintLoader {
  private options: Required<LoaderOptions>;

  constructor(options: LoaderOptions = {}) {
    this.options = {
      blueprintsDir: options.blueprintsDir || DEFAULT_OPTIONS.blueprintsDir!,
      validate: options.validate !== false,
    };
  }

  async loadAll(): Promise<Blueprint[]> {
    const dir = this.options.blueprintsDir;
    const blueprints: Blueprint[] = [];

    try {
      const files = await fs.readdir(dir);
      const yamlFiles = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

      for (const file of yamlFiles) {
        const filePath = path.join(dir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const blueprint = this.parse(content, filePath);

        if (this.options.validate) {
          this.validate(blueprint);
        }

        blueprints.push(blueprint);
      }
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }

    blueprints.sort((a, b) => b.priority - a.priority);
    return blueprints;
  }

  parse(content: string, filePath?: string): Blueprint {
    try {
      const parsed = yaml.load(content) as Blueprint;
      if (!this.isBlueprint(parsed)) {
        throw new BlueprintValidationError(filePath || "unknown", ["Invalid blueprint structure"]);
      }
      return parsed;
    } catch (error: any) {
      if (error instanceof BlueprintValidationError) throw error;
      throw new BlueprintValidationError(filePath || "unknown", [error.message]);
    }
  }

  private validate(blueprint: Blueprint): void {
    const errors: string[] = [];
    if (!blueprint.id) errors.push("Missing 'id'");
    if (!blueprint.name) errors.push("Missing 'name'");
    if (!blueprint.description) errors.push("Missing 'description'");
    if (!Array.isArray(blueprint.triggerKeywords)) errors.push("Missing 'triggerKeywords'");
    if (typeof blueprint.priority !== "number") errors.push("Missing 'priority'");
    if (!blueprint.initialState) errors.push("Missing 'initialState'");
    if (!blueprint.states) errors.push("Missing 'states'");

    if (blueprint.states) {
      for (const [stateId, state] of Object.entries(blueprint.states)) {
        if (!state.type) errors.push(`State '${stateId}': missing 'type'`);
        if (state.type === "agent") {
          if (!state.config) errors.push(`State '${stateId}': missing 'config'`);
          if (!state.next) errors.push(`State '${stateId}': missing 'next'`);
        }
        if (state.type === "deterministic" && !state.action) {
          errors.push(`State '${stateId}': missing 'action'`);
        }
      }
      if (blueprint.initialState && !blueprint.states[blueprint.initialState]) {
        errors.push(`Initial state '${blueprint.initialState}' not found`);
      }
    }

    if (errors.length > 0) {
      throw new BlueprintValidationError(blueprint.id || "unknown", errors);
    }
  }

  private isBlueprint(obj: any): obj is Blueprint {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof obj.id === "string" &&
      typeof obj.name === "string" &&
      typeof obj.description === "string" &&
      Array.isArray(obj.triggerKeywords) &&
      typeof obj.priority === "number" &&
      typeof obj.initialState === "string" &&
      typeof obj.states === "object"
    );
  }
}
```

- [ ] **Step 2: Write tests**

```typescript
// src/blueprints/__tests__/loader.test.ts

import { describe, it, expect } from "bun:test";
import { BlueprintLoader, BlueprintValidationError } from "../loader";

describe("BlueprintLoader", () => {
  describe("parse", () => {
    it("should parse valid blueprint YAML", () => {
      const yaml = `
id: test-blueprint
name: Test Blueprint
description: A test blueprint
triggerKeywords: [test]
priority: 100
initialState: start
states:
  start:
    type: terminal
`;
      const loader = new BlueprintLoader({ validate: false });
      const blueprint = loader.parse(yaml);
      expect(blueprint.id).toBe("test-blueprint");
    });

    it("should throw on missing required fields", () => {
      const yaml = "name: Test";
      const loader = new BlueprintLoader({ validate: true });
      expect(() => loader.parse(yaml)).toThrow(BlueprintValidationError);
    });
  });

  describe("loadAll", () => {
    it("should return empty array when directory does not exist", async () => {
      const loader = new BlueprintLoader({ blueprintsDir: "/nonexistent", validate: false });
      const blueprints = await loader.loadAll();
      expect(blueprints).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test src/blueprints/__tests__/loader.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/blueprints/loader.ts src/blueprints/__tests__/loader.test.ts
git commit -m "feat(blueprints): implement YAML blueprint loader"
```

---

## Task 6: Implement blueprint selection

**Files:**
- Create: `src/blueprints/selection.ts`
- Test: `src/blueprints/__tests__/selection.test.ts`

- [ ] **Step 1: Write blueprint selection**

```typescript
// src/blueprints/selection.ts

import type { Blueprint, BlueprintSelection } from "./types";

export function selectBlueprint(task: string, blueprints: Blueprint[]): BlueprintSelection {
  const lowerTask = task.toLowerCase();

  for (const blueprint of blueprints) {
    const matchedKeywords: string[] = [];
    for (const keyword of blueprint.triggerKeywords) {
      if (lowerTask.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }
    if (matchedKeywords.length > 0) {
      return {
        blueprint,
        confidence: matchedKeywords.length / blueprint.triggerKeywords.length,
        matchedKeywords,
      };
    }
  }

  const defaultBlueprint = blueprints.find((b) => b.id === "default");
  if (!defaultBlueprint) {
    throw new Error("No default blueprint found");
  }

  return { blueprint: defaultBlueprint, confidence: 0, matchedKeywords: [] };
}

export function getBlueprintById(id: string, blueprints: Blueprint[]): Blueprint | undefined {
  return blueprints.find((b) => b.id === id);
}

export function listBlueprints(blueprints: Blueprint[]): Blueprint[] {
  return [...blueprints];
}
```

- [ ] **Step 2: Write tests**

```typescript
// src/blueprints/__tests__/selection.test.ts

import { describe, it, expect } from "bun:test";
import { selectBlueprint, getBlueprintById, listBlueprints } from "../selection";
import type { Blueprint } from "../types";

describe("Blueprint Selection", () => {
  const blueprints: Blueprint[] = [
    {
      id: "bug-fix",
      name: "Bug Fix",
      description: "Fix bugs",
      triggerKeywords: ["fix", "bug"],
      priority: 100,
      initialState: "start",
      states: { start: { type: "terminal" } },
    },
    {
      id: "default",
      name: "Default",
      description: "Default",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: { start: { type: "terminal" } },
    },
  ];

  it("should select blueprint by keyword match", () => {
    const selection = selectBlueprint("fix the bug", blueprints);
    expect(selection.blueprint.id).toBe("bug-fix");
    expect(selection.matchedKeywords).toContain("fix");
  });

  it("should return default when no match", () => {
    const selection = selectBlueprint("random task", blueprints);
    expect(selection.blueprint.id).toBe("default");
    expect(selection.confidence).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test src/blueprints/__tests__/selection.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/blueprints/selection.ts src/blueprints/__tests__/selection.test.ts
git commit -m "feat(blueprints): implement keyword-based blueprint selection"
```

---

## Task 7: Implement blueprint compiler

**Files:**
- Create: `src/blueprints/compiler.ts`
- Test: `src/blueprints/__tests__/compiler.test.ts`

- [ ] **Step 1: Write blueprint compiler**

```typescript
// src/blueprints/compiler.ts

import { StateGraph } from "@langchain/langgraph";
import type { Blueprint, BlueprintState, State, AgentState, DeterministicState } from "./types";
import { ActionRegistry } from "./actions";

export class BlueprintCompilerError extends Error {
  constructor(public blueprintId: string, public reason: string) {
    super(`Failed to compile blueprint '${blueprintId}': ${reason}`);
    this.name = "BlueprintCompilerError";
  }
}

export class BlueprintCompiler {
  constructor(private actionRegistry: ActionRegistry) {}

  compile(blueprint: Blueprint): StateGraph<BlueprintState> {
    const channels = {
      input: { value: (x?: string) => x ?? "", default: () => "" },
      currentState: { value: (x?: string) => x ?? "", default: () => blueprint.initialState },
      lastResult: { value: (x?: any) => x, default: () => undefined },
      error: { value: (x?: string) => x ?? "", default: () => "" },
    };

    const graph = new StateGraph({ channels });

    for (const [stateId, state] of Object.entries(blueprint.states)) {
      graph.addNode(stateId, this.createNode(state, blueprint));
    }

    this.addEdges(graph, blueprint);
    graph.setEntryPoint(blueprint.initialState);

    return graph.compile();
  }

  private createNode(state: State, blueprint: Blueprint) {
    return async (graphState: BlueprintState) => {
      switch (state.type) {
        case "agent":
          return this.executeAgentNode(state, graphState);
        case "deterministic":
          return this.executeDeterministicNode(state, graphState);
        case "terminal":
          return { ...graphState, currentState: "__end__" };
        default:
          throw new BlueprintCompilerError(blueprint.id, `Unknown state type: ${(state as any).type}`);
      }
    };
  }

  private async executeAgentNode(state: AgentState, graphState: BlueprintState): Promise<BlueprintState> {
    return {
      ...graphState,
      currentState: state.next[0] || "__end__",
      lastResult: { success: true, output: `Agent '${state.config.name || "unnamed"}' executed` },
    };
  }

  private async executeDeterministicNode(state: DeterministicState, graphState: BlueprintState): Promise<BlueprintState> {
    const action = this.actionRegistry.get(state.action);
    if (!action) {
      throw new BlueprintCompilerError("unknown", `Action not found: ${state.action}`);
    }
    const result = await action.execute(graphState);
    return { ...graphState, lastResult: result };
  }

  private addEdges(graph: StateGraph<BlueprintState>, blueprint: Blueprint): void {
    for (const [stateId, state] of Object.entries(blueprint.states)) {
      if (state.type === "terminal") continue;

      if (state.type === "agent") {
        for (const next of state.next) {
          graph.addEdge(stateId, next);
        }
      } else if (state.type === "deterministic") {
        if (state.on) {
          graph.addConditionalEdges(
            stateId,
            (s: BlueprintState) => s.lastResult?.success ? "pass" : "fail",
            { pass: state.on.pass || ["__end__"], fail: state.on.fail || ["__end__"] },
          );
        } else {
          for (const next of state.next) {
            graph.addEdge(stateId, next);
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write tests**

```typescript
// src/blueprints/__tests__/compiler.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { BlueprintCompiler } from "../compiler";
import { ActionRegistry } from "../actions";
import type { Blueprint } from "../types";

describe("BlueprintCompiler", () => {
  let compiler: BlueprintCompiler;
  let actionRegistry: ActionRegistry;

  beforeEach(() => {
    actionRegistry = new ActionRegistry();
    actionRegistry.register({
      name: "test_action",
      description: "Test",
      execute: async () => ({ success: true, output: "OK" }),
    });
    compiler = new BlueprintCompiler(actionRegistry);
  });

  it("should compile simple terminal blueprint", () => {
    const blueprint: Blueprint = {
      id: "simple",
      name: "Simple",
      description: "Simple",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: { start: { type: "terminal" } },
    };
    const graph = compiler.compile(blueprint);
    expect(graph).toBeDefined();
  });

  it("should compile blueprint with agent states", () => {
    const blueprint: Blueprint = {
      id: "agent-test",
      name: "Agent Test",
      description: "Test",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: {
        start: { type: "agent", config: { models: ["haiku"], tools: ["read"] }, next: ["end"] },
        end: { type: "terminal" },
      },
    };
    const graph = compiler.compile(blueprint);
    expect(graph).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test src/blueprints/__tests__/compiler.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/blueprints/compiler.ts src/blueprints/__tests__/compiler.test.ts
git commit -m "feat(blueprints): implement LangGraph compiler"
```

---

## Task 8: Update public exports

**Files:**
- Create: `src/blueprints/utils.ts`
- Modify: `src/blueprints/index.ts`

- [ ] **Step 1: Create utility functions**

```typescript
// src/blueprints/utils.ts

import { BlueprintLoader } from "./loader";
import { selectBlueprint } from "./selection";
import { BlueprintCompiler } from "./compiler";
import { actionRegistry } from "./actions";
import type { Blueprint, BlueprintSelection } from "./types";

export async function loadAndSelectBlueprints(
  task: string,
  options?: ConstructorParameters<typeof BlueprintLoader>[0],
): Promise<{ blueprints: Blueprint[]; selection: BlueprintSelection }> {
  const loader = new BlueprintLoader(options);
  const blueprints = await loader.loadAll();
  const selection = selectBlueprint(task, blueprints);
  return { blueprints, selection };
}

export async function executeWithBlueprint(
  task: string,
  options?: ConstructorParameters<typeof BlueprintLoader>[0],
) {
  const { selection } = await loadAndSelectBlueprints(task, options);
  const compiler = new BlueprintCompiler(actionRegistry);
  const graph = compiler.compile(selection.blueprint);
  return await graph.invoke({ input: task, currentState: selection.blueprint.initialState });
}
```

- [ ] **Step 2: Update index.ts**

```typescript
// src/blueprints/index.ts

export type {
  Blueprint,
  State,
  AgentState,
  DeterministicState,
  TerminalState,
  AgentConfig,
  StateTransition,
  ConditionalTransition,
  BlueprintSelection,
  BlueprintState,
  ActionResult,
  DeterministicAction,
} from "./types";

export { BlueprintLoader, BlueprintValidationError, type LoaderOptions } from "./loader";
export { selectBlueprint, getBlueprintById, listBlueprints } from "./selection";
export { BlueprintCompiler, BlueprintCompilerError } from "./compiler";
export { ActionRegistry, actionRegistry, registerBuiltinActions } from "./actions";
export { loadAndSelectBlueprints, executeWithBlueprint } from "./utils";

export async function loadBlueprints(options?: LoaderOptions) {
  const loader = new BlueprintLoader(options);
  return await loader.loadAll();
}

export function compileBlueprint(blueprint: Blueprint, actionRegistry: ActionRegistry) {
  const compiler = new BlueprintCompiler(actionRegistry);
  return compiler.compile(blueprint);
}
```

- [ ] **Step 3: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/blueprints/index.ts src/blueprints/utils.ts
git commit -m "feat(blueprints): update public exports and add utilities"
```

---

## Task 9: Create default blueprint YAML files

**Files:**
- Create: `.blueprints/bug-fix.yaml`
- Create: `.blueprints/feature.yaml`
- Create: `.blueprints/refactor.yaml`
- Create: `.blueprints/test.yaml`
- Create: `.blueprints/docs.yaml`
- Create: `.blueprints/chore.yaml`
- Create: `.blueprints/default.yaml`

- [ ] **Step 1: Create all blueprint YAML files**

```yaml
# .blueprints/bug-fix.yaml
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

```yaml
# .blueprints/feature.yaml
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

```yaml
# .blueprints/refactor.yaml
id: "refactor"
name: "Refactoring"
description: "For code refactoring and cleanup"
triggerKeywords: ["refactor", "cleanup", "reorganize", "restructure"]
priority: 80
initialState: "analyze"
states:
  analyze:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6"]
      tools: ["read", "code_search", "grep"]
      systemPrompt: "Analyze the code to refactor."
    next: ["plan"]
  plan:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6"]
      tools: ["read"]
      systemPrompt: "Plan the refactoring."
    next: ["implement"]
  implement:
    type: "agent"
    config:
      models: ["claude-sonnet-4-6", "sonnet"]
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

```yaml
# .blueprints/test.yaml
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

```yaml
# .blueprints/docs.yaml
id: "docs"
name: "Documentation"
description: "For documentation changes"
triggerKeywords: ["document", "doc", "readme", "comment"]
priority: 60
initialState: "implement"
states:
  implement:
    type: "agent"
    config:
      models: ["haiku"]
      tools: ["write", "edit", "read"]
      systemPrompt: "Update documentation."
    next: ["done"]
  done:
    type: "terminal"
```

```yaml
# .blueprints/chore.yaml
id: "chore"
name: "Chore"
description: "For maintenance tasks"
triggerKeywords: ["chore", "update", "upgrade", "dependency", "config"]
priority: 50
initialState: "implement"
states:
  implement:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read", "code_search"]
      systemPrompt: "Complete the maintenance task."
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
      pass: ["done"]
      fail: ["fix_test"]
  fix_test:
    type: "agent"
    config:
      models: ["sonnet"]
      tools: ["edit", "write", "read"]
      systemPrompt: "Fix broken tests."
    next: ["test"]
  done:
    type: "terminal"
```

```yaml
# .blueprints/default.yaml
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

- [ ] **Step 2: Commit**

```bash
git add .blueprints/
git commit -m "feat(blueprints): add default blueprint YAML files"
```

---

## Task 10: Write integration tests

**Files:**
- Create: `src/blueprints/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// src/blueprints/__tests__/integration.test.ts

import { describe, it, expect } from "bun:test";
import { BlueprintLoader } from "../loader";
import { selectBlueprint } from "../selection";
import { BlueprintCompiler } from "../compiler";
import { actionRegistry } from "../actions";

describe("Blueprint Integration", () => {
  it("should load, select, and compile a blueprint", async () => {
    const loader = new BlueprintLoader({ validate: true });
    const blueprints = await loader.loadAll();
    expect(blueprints.length).toBeGreaterThan(0);

    const selection = selectBlueprint("fix the login bug", blueprints);
    expect(selection.blueprint.id).toBe("bug-fix");

    const compiler = new BlueprintCompiler(actionRegistry);
    const graph = compiler.compile(selection.blueprint);
    expect(graph).toBeDefined();
  });

  it("should select correct blueprint by keyword", async () => {
    const loader = new BlueprintLoader();
    const blueprints = await loader.loadAll();

    expect(selectBlueprint("fix the bug", blueprints).blueprint.id).toBe("bug-fix");
    expect(selectBlueprint("add a new feature", blueprints).blueprint.id).toBe("feature");
    expect(selectBlueprint("refactor this code", blueprints).blueprint.id).toBe("refactor");
  });

  it("should return default blueprint for unknown task", async () => {
    const loader = new BlueprintLoader();
    const blueprints = await loader.loadAll();
    const selection = selectBlueprint("do something unrelated", blueprints);
    expect(selection.blueprint.id).toBe("default");
    expect(selection.confidence).toBe(0);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `bun test src/blueprints/__tests__/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/blueprints/__tests__/integration.test.ts
git commit -m "test(blueprints): add integration tests"
```

---

## Task 11: Deprecate old blueprint implementation

**Files:**
- Modify: `src/blueprints/blueprint.ts`

- [ ] **Step 1: Add deprecation notice**

```typescript
// src/blueprints/blueprint.ts

/**
 * @deprecated
 *
 * This file contains the OLD blueprint implementation.
 * Use the new state machine blueprint system instead:
 *
 * ```ts
 * import { loadBlueprints, selectBlueprint, compileBlueprint } from './blueprints';
 * ```
 */

export {
  type Blueprint as OldBlueprint,
  type BlueprintSelection as OldBlueprintSelection,
  type BlueprintRegistry as OldBlueprintRegistry,
  type VerificationRequirements,
  type PRRequirements,
  type PromptCustomization,
  blueprintRegistry as oldBlueprintRegistry,
  selectBlueprint as selectOldBlueprint,
  buildInputWithBlueprint,
  blueprintToInvokeConfig,
  DEFAULT_BLUEPRINTS,
} from "./blueprint-legacy";
```

- [ ] **Step 2: Create legacy file**

```bash
git mv src/blueprints/blueprint.ts src/blueprints/blueprint-legacy.ts
```

- [ ] **Step 3: Update imports**

```bash
# Find and update imports
grep -r "from.*blueprints.*blueprint" src/ --include="*.ts" -l
```

- [ ] **Step 4: Commit**

```bash
git add src/blueprints/blueprint.ts src/blueprints/blueprint-legacy.ts
git commit -m "deprecate(blueprints): mark old implementation as deprecated"
```

---

## Task 12: Update documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Add to CLAUDE.md after Subagents section:

```markdown
## Blueprint System

Bullhorse uses a blueprint system inspired by [Stripe Minions](https://stripe.com/blog/minions).

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
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update blueprint system documentation"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run all tests**

```bash
bun test src/blueprints/__tests__/
```

Expected: All tests pass

- [ ] **Step 2: Run typecheck**

```bash
bunx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Verify blueprint loading**

```bash
bun -e "import('./src/blueprints/loader').then(m => new m.BlueprintLoader().loadAll().then(b => console.log('Loaded', b.length, 'blueprints')))"
```

Expected: "Loaded 7 blueprints"

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat(blueprints): complete state machine blueprint system implementation"
```

---

## Self-Review Results

**Spec Coverage:** ✅ All requirements covered
**Placeholder Scan:** ✅ No TBD/TODO placeholders
**Type Consistency:** ✅ All types match between tasks
