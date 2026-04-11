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
  /** Conditional transitions (takes precedence over next if both exist) */
  on?: ConditionalTransition;
  /** Simple transition (used if on is not specified) */
  next?: StateTransition;
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
