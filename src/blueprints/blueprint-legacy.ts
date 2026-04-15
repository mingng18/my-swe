/**
 * Blueprint System
 *
 * This system helps the agent self-organize by selecting an execution blueprint
 * based on the task description. The blueprint defines what needs to be done,
 * what verification steps are required, and how to format the PR.
 *
 * Think of it as answering the question: "How should we configure the agent for THIS task?"
 *
 * References:
 * - https://github.com/stripe/minions
 * - Internal enterprise transformation plan (Phase 1)
 */

import type { AgentInvokeOptions } from "../harness/agentHarness";

/**
 * Verification requirements for a blueprint.
 */
export interface VerificationRequirements {
  /** Whether tests must pass before considering the task complete */
  requireTests: boolean;

  /** Whether linting must pass */
  requireLint: boolean;

  /** Whether type checking must pass */
  requireTypeCheck: boolean;

  /** Maximum number of fix iterations allowed */
  maxFixIterations: number;
}

/**
 * PR creation requirements for a blueprint.
 */
export interface PRRequirements {
  /** Whether to auto-create PR after task completion */
  autoCreate: boolean;

  /** PR title template (use {{type}} and {{description}} placeholders) */
  titleTemplate?: string;

  /** Whether to require human approval before creating PR */
  requireApproval: boolean;
}

/**
 * System prompt customization for a blueprint.
 */
export interface PromptCustomization {
  /** Additional instructions to prepend to the system prompt */
  prepend?: string;

  /** Additional instructions to append to the system prompt */
  append?: string;

  /** Whether to emphasize code quality */
  emphasizeQuality?: boolean;

  /** Whether to emphasize testing */
  emphasizeTesting?: boolean;
}

/**
 * Blueprint definition - workflow template for task execution.
 *
 * A blueprint selects how to configure the agent for a specific type of task.
 * It does NOT execute anything itself - it just provides metadata.
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

  /** Verification requirements */
  verification: VerificationRequirements;

  /** PR creation requirements */
  pr: PRRequirements;

  /** Optional prompt customization */
  prompt?: PromptCustomization;

  /** Whether this is the default blueprint (used when no keywords match) */
  isDefault?: boolean;
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
 * Internal optimized representation of a blueprint.
 */
interface OptimizedBlueprint {
  blueprint: Blueprint;
  lowerKeywords: string[];
  regex: RegExp | null;
}

/**
 * Blueprint registry - manages available blueprints and selects appropriate ones.
 *
 * This is the ONLY new component needed. Everything else (execution, retry,
 * verification, PR creation) is already handled by existing DeepAgents infrastructure.
 */
export class BlueprintRegistry {
  private blueprints: Blueprint[];
  private optimizedBlueprints: OptimizedBlueprint[];
  private cachedDefaultBlueprint: Blueprint | undefined;

  constructor() {
    this.blueprints = [];
    this.optimizedBlueprints = [];
  }

  /**
   * Register a blueprint.
   */
  register(blueprint: Blueprint): void {
    this.blueprints.push(blueprint);
    // Sort by priority (descending)
    this.blueprints.sort((a, b) => b.priority - a.priority);

    // Update cached default blueprint
    if (blueprint.isDefault) {
      this.cachedDefaultBlueprint = blueprint;
    } else if (!this.cachedDefaultBlueprint) {
      this.cachedDefaultBlueprint = this.blueprints.find((b) => b.isDefault);
    }

    // Rebuild optimized representations to keep them sorted
    this.optimizedBlueprints = this.blueprints.map((b) => ({
      blueprint: b,
      lowerKeywords: b.triggerKeywords ? b.triggerKeywords.map(k => k.toLowerCase()) : [],
      regex: b.triggerKeywords && b.triggerKeywords.length > 0 ? new RegExp(`(${b.triggerKeywords.join('|')})`, 'i') : null
    }));
  }

  /**
   * Select the best blueprint for a given task.
   *
   * Returns the blueprint with the highest priority that matches any keywords.
   * If no blueprint matches, returns the default blueprint.
   */
  select(task: string): BlueprintSelection {
    // Try to find a matching blueprint (checked in priority order)
    for (const opt of this.optimizedBlueprints) {
      if (opt.regex && !opt.regex.test(task)) {
        continue;
      }

      // If there's no regex (e.g. empty keywords) or it matched, fall back to exact matching
      const lowerTask = task.toLowerCase();
      const matchedKeywords: string[] = [];
      const lowerKeywords = opt.lowerKeywords;

      for (let i = 0; i < lowerKeywords.length; i++) {
        if (lowerTask.includes(lowerKeywords[i])) {
          matchedKeywords.push(opt.blueprint.triggerKeywords[i]);
        }
      }

      if (matchedKeywords.length > 0) {
        return {
          blueprint: opt.blueprint,
          confidence: matchedKeywords.length / opt.blueprint.triggerKeywords.length,
          matchedKeywords,
        };
      }
    }

    // No match found - return default blueprint
    if (!this.cachedDefaultBlueprint) {
      throw new Error("No default blueprint registered");
    }

    return {
      blueprint: this.cachedDefaultBlueprint,
      confidence: 0,
      matchedKeywords: [],
    };
  }

  /**
   * Get a blueprint by ID.
   */
  getById(id: string): Blueprint | undefined {
    return this.blueprints.find((b) => b.id === id);
  }

  /**
   * List all registered blueprints.
   */
  list(): Blueprint[] {
    return [...this.blueprints];
  }

  /**
   * Get the default blueprint.
   */
  getDefault(): Blueprint | undefined {
    return this.cachedDefaultBlueprint;
  }
}

/**
 * Default blueprints for common task types.
 */
export const DEFAULT_BLUEPRINTS: Blueprint[] = [
  {
    id: "bug-fix",
    name: "Bug Fix",
    description: "For fixing bugs and errors",
    triggerKeywords: ["fix", "bug", "error", "broken", "not working", "issue"],
    priority: 100,
    verification: {
      requireTests: true,
      requireLint: true,
      requireTypeCheck: true,
      maxFixIterations: 2,
    },
    pr: {
      autoCreate: true,
      titleTemplate: "fix: {{description}}",
      requireApproval: false,
    },
    prompt: {
      emphasizeQuality: true,
      emphasizeTesting: true,
    },
  },
  {
    id: "feature",
    name: "Feature Implementation",
    description: "For implementing new features",
    triggerKeywords: ["implement", "add", "feature", "create", "new"],
    priority: 90,
    verification: {
      requireTests: true,
      requireLint: true,
      requireTypeCheck: true,
      maxFixIterations: 3,
    },
    pr: {
      autoCreate: true,
      titleTemplate: "feat: {{description}}",
      requireApproval: false,
    },
    prompt: {
      emphasizeQuality: true,
      emphasizeTesting: true,
    },
  },
  {
    id: "refactor",
    name: "Refactoring",
    description: "For code refactoring and cleanup",
    triggerKeywords: ["refactor", "cleanup", "reorganize", "restructure"],
    priority: 80,
    verification: {
      requireTests: true,
      requireLint: true,
      requireTypeCheck: true,
      maxFixIterations: 2,
    },
    pr: {
      autoCreate: true,
      titleTemplate: "refactor: {{description}}",
      requireApproval: false,
    },
    prompt: {
      emphasizeQuality: true,
      emphasizeTesting: true,
    },
  },
  {
    id: "test",
    name: "Test Addition",
    description: "For adding tests",
    triggerKeywords: ["test", "spec", "coverage"],
    priority: 70,
    verification: {
      requireTests: true,
      requireLint: true,
      requireTypeCheck: false,
      maxFixIterations: 1,
    },
    pr: {
      autoCreate: true,
      titleTemplate: "test: {{description}}",
      requireApproval: false,
    },
    prompt: {
      emphasizeTesting: true,
    },
  },
  {
    id: "docs",
    name: "Documentation",
    description: "For documentation changes",
    triggerKeywords: ["document", "doc", "readme", "comment"],
    priority: 60,
    verification: {
      requireTests: false,
      requireLint: false,
      requireTypeCheck: false,
      maxFixIterations: 0,
    },
    pr: {
      autoCreate: true,
      titleTemplate: "docs: {{description}}",
      requireApproval: false,
    },
  },
  {
    id: "chore",
    name: "Chore",
    description: "For maintenance tasks",
    triggerKeywords: ["chore", "update", "upgrade", "dependency", "config"],
    priority: 50,
    verification: {
      requireTests: true,
      requireLint: true,
      requireTypeCheck: true,
      maxFixIterations: 1,
    },
    pr: {
      autoCreate: true,
      titleTemplate: "chore: {{description}}",
      requireApproval: false,
    },
  },
  {
    id: "default",
    name: "Default",
    description: "Default blueprint for general tasks",
    triggerKeywords: [],
    priority: 0,
    isDefault: true,
    verification: {
      requireTests: false,
      requireLint: false,
      requireTypeCheck: false,
      maxFixIterations: 2,
    },
    pr: {
      autoCreate: true,
      requireApproval: false,
    },
  },
];

/**
 * Global blueprint registry instance.
 */
export const blueprintRegistry = new BlueprintRegistry();

// Register default blueprints
for (const blueprint of DEFAULT_BLUEPRINTS) {
  blueprintRegistry.register(blueprint);
}

/**
 * Select a blueprint for the given task.
 *
 * This is the main entry point for blueprint selection.
 */
export function selectBlueprint(task: string): BlueprintSelection {
  return blueprintRegistry.select(task);
}

/**
 * Build input with blueprint-specific prompt modifications.
 *
 * This is where blueprints interface with the existing DeepAgents infrastructure.
 * The caller can use this to customize the input based on the selected blueprint.
 */
export function buildInputWithBlueprint(
  task: string,
  selection: BlueprintSelection,
): string {
  const { blueprint } = selection;
  const prompt = blueprint.prompt;

  if (!prompt) {
    return task;
  }

  let modified = task;

  if (prompt.prepend) {
    modified = `${prompt.prepend}\n\n${modified}`;
  }

  if (prompt.append) {
    modified = `${modified}\n\n${prompt.append}`;
  }

  if (prompt.emphasizeQuality) {
    modified +=
      "\n\nRemember: Focus on code quality - clean, readable, maintainable code.";
  }

  if (prompt.emphasizeTesting) {
    modified +=
      "\n\nRemember: Write comprehensive tests to verify your changes.";
  }

  return modified;
}

/**
 * Get blueprint configuration for agent invoke options.
 *
 * Since AgentInvokeOptions is minimal, this returns the options unchanged.
 * The blueprint selection should be used at the call site to customize behavior.
 *
 * @deprecated Use buildInputWithBlueprint to customize input instead
 */
export function blueprintToInvokeConfig(
  _selection: BlueprintSelection,
  baseOptions: AgentInvokeOptions,
): AgentInvokeOptions {
  // Currently, AgentInvokeOptions only has threadId
  // Blueprint customization happens via input modification
  return baseOptions;
}
