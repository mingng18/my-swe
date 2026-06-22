// src/blueprints/builtins.ts
/**
 * Built-in state-machine blueprints.
 *
 * These mirror the legacy blueprints from blueprint-legacy.ts but are defined
 * as proper state machines with states, initialState, and transitions that the
 * BlueprintCompiler can compile into LangGraph graphs.
 *
 * Each blueprint defines a workflow:
 *   agent -> verify -> check (pass -> pr, fail -> agent with retries)
 */

import type { Blueprint } from "./types";

// ---------------------------------------------------------------------------
// Common agent config
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_CONFIG = {
  models: [] as string[],
  tools: [] as string[],
};

// ---------------------------------------------------------------------------
// bug-fix  (priority 100)
// agent -> verify -> check (pass -> create_pr, fail -> agent, max 2 retries)
// ---------------------------------------------------------------------------

const bugFixBlueprint: Blueprint = {
  id: "bug-fix",
  name: "Bug Fix",
  description: "For fixing bugs and errors. Requires tests and lint to pass before PR.",
  triggerKeywords: ["fix", "bug", "error", "broken", "not working", "issue"],
  priority: 100,
  initialState: "agent",
  states: {
    agent: {
      type: "agent",
      config: {
        ...DEFAULT_AGENT_CONFIG,
        name: "bug-fix-agent",
        systemPrompt:
          "You are fixing a bug. Focus on the root cause, write minimal changes, and ensure tests pass.",
      },
      next: ["verify"],
    },
    verify: {
      type: "deterministic",
      action: "verify_tests_and_lint",
      on: {
        pass: ["create_pr"],
        fail: ["agent"],
      },
    },
    create_pr: {
      type: "deterministic",
      action: "create_pr",
      next: ["__end__"],
    },
  },
};

// ---------------------------------------------------------------------------
// feature  (priority 90)
// agent -> verify -> check (pass -> create_pr, fail -> agent, max 3 retries)
// ---------------------------------------------------------------------------

const featureBlueprint: Blueprint = {
  id: "feature",
  name: "Feature Implementation",
  description: "For implementing new features. Requires tests and lint with up to 3 retries.",
  triggerKeywords: ["implement", "add", "feature", "create", "new"],
  priority: 90,
  initialState: "agent",
  states: {
    agent: {
      type: "agent",
      config: {
        ...DEFAULT_AGENT_CONFIG,
        name: "feature-agent",
        systemPrompt:
          "You are implementing a new feature. Write clean, well-tested code following project conventions.",
      },
      next: ["verify"],
    },
    verify: {
      type: "deterministic",
      action: "verify_tests_and_lint",
      on: {
        pass: ["create_pr"],
        fail: ["agent"],
      },
    },
    create_pr: {
      type: "deterministic",
      action: "create_pr",
      next: ["__end__"],
    },
  },
};

// ---------------------------------------------------------------------------
// refactor  (priority 80)
// agent -> verify -> check (pass -> create_pr, fail -> agent, max 2 retries)
// ---------------------------------------------------------------------------

const refactorBlueprint: Blueprint = {
  id: "refactor",
  name: "Refactoring",
  description: "For code refactoring and cleanup. Requires tests and lint to pass.",
  triggerKeywords: ["refactor", "cleanup", "reorganize", "restructure"],
  priority: 80,
  initialState: "agent",
  states: {
    agent: {
      type: "agent",
      config: {
        ...DEFAULT_AGENT_CONFIG,
        name: "refactor-agent",
        systemPrompt:
          "You are refactoring code. Preserve behavior, improve structure, and ensure all tests still pass.",
      },
      next: ["verify"],
    },
    verify: {
      type: "deterministic",
      action: "verify_tests_and_lint",
      on: {
        pass: ["create_pr"],
        fail: ["agent"],
      },
    },
    create_pr: {
      type: "deterministic",
      action: "create_pr",
      next: ["__end__"],
    },
  },
};

// ---------------------------------------------------------------------------
// test  (priority 70)
// agent -> verify_no_typecheck -> check (pass -> create_pr, fail -> agent, 1 retry)
// ---------------------------------------------------------------------------

const testBlueprint: Blueprint = {
  id: "test",
  name: "Test Addition",
  description: "For adding tests. Runs tests and lint (no typecheck). Max 1 retry.",
  triggerKeywords: ["test", "spec", "coverage"],
  priority: 70,
  initialState: "agent",
  states: {
    agent: {
      type: "agent",
      config: {
        ...DEFAULT_AGENT_CONFIG,
        name: "test-agent",
        systemPrompt:
          "You are writing tests. Focus on comprehensive coverage and clear assertions.",
      },
      next: ["verify"],
    },
    verify: {
      type: "deterministic",
      action: "verify_no_typecheck",
      on: {
        pass: ["create_pr"],
        fail: ["agent"],
      },
    },
    create_pr: {
      type: "deterministic",
      action: "create_pr",
      next: ["__end__"],
    },
  },
};

// ---------------------------------------------------------------------------
// docs  (priority 60)
// agent -> create_pr (no verification)
// ---------------------------------------------------------------------------

const docsBlueprint: Blueprint = {
  id: "docs",
  name: "Documentation",
  description: "For documentation changes. No verification required.",
  triggerKeywords: ["document", "doc", "readme", "comment"],
  priority: 60,
  initialState: "agent",
  states: {
    agent: {
      type: "agent",
      config: {
        ...DEFAULT_AGENT_CONFIG,
        name: "docs-agent",
        systemPrompt:
          "You are writing documentation. Be clear, concise, and follow the project's documentation style.",
      },
      next: ["create_pr"],
    },
    create_pr: {
      type: "deterministic",
      action: "create_pr",
      next: ["__end__"],
    },
  },
};

// ---------------------------------------------------------------------------
// chore  (priority 50)
// agent -> verify -> check (pass -> create_pr, fail -> agent, 1 retry)
// ---------------------------------------------------------------------------

const choreBlueprint: Blueprint = {
  id: "chore",
  name: "Chore",
  description: "For maintenance tasks. Requires tests and lint. Max 1 retry.",
  triggerKeywords: ["chore", "update", "upgrade", "dependency", "config"],
  priority: 50,
  initialState: "agent",
  states: {
    agent: {
      type: "agent",
      config: {
        ...DEFAULT_AGENT_CONFIG,
        name: "chore-agent",
        systemPrompt:
          "You are performing a maintenance task. Be careful with dependency updates and ensure nothing breaks.",
      },
      next: ["verify"],
    },
    verify: {
      type: "deterministic",
      action: "verify_tests_and_lint",
      on: {
        pass: ["create_pr"],
        fail: ["agent"],
      },
    },
    create_pr: {
      type: "deterministic",
      action: "create_pr",
      next: ["__end__"],
    },
  },
};

// ---------------------------------------------------------------------------
// default  (priority 0)
// agent -> create_pr (minimal verification)
// ---------------------------------------------------------------------------

const defaultBlueprint: Blueprint = {
  id: "default",
  name: "Default",
  description: "Default blueprint for general tasks. Minimal verification.",
  triggerKeywords: [],
  priority: 0,
  initialState: "agent",
  states: {
    agent: {
      type: "agent",
      config: {
        ...DEFAULT_AGENT_CONFIG,
        name: "default-agent",
      },
      next: ["create_pr"],
    },
    create_pr: {
      type: "deterministic",
      action: "create_pr",
      next: ["__end__"],
    },
  },
};

// ---------------------------------------------------------------------------
// Exported list
// ---------------------------------------------------------------------------

/**
 * All built-in state-machine blueprints, sorted by priority (descending).
 *
 * Each blueprint carries a `maxIterations` hint in the description metadata
 * that the compiler's feedback-loop mode can read:
 *   - bug-fix: 2
 *   - feature: 3
 *   - refactor: 2
 *   - test: 1
 *   - docs: 0 (no verification)
 *   - chore: 1
 *   - default: 0 (no verification)
 */
export const BUILTIN_BLUEPRINTS: Blueprint[] = [
  bugFixBlueprint,
  featureBlueprint,
  refactorBlueprint,
  testBlueprint,
  docsBlueprint,
  choreBlueprint,
  defaultBlueprint,
];

/**
 * Max iterations (retries) per blueprint ID.
 * Used by the feedback loop compiler.
 */
export const BLUEPRINT_MAX_ITERATIONS: Record<string, number> = {
  "bug-fix": 2,
  feature: 3,
  refactor: 2,
  test: 1,
  docs: 0,
  chore: 1,
  default: 0,
};
