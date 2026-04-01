import { Annotation } from "@langchain/langgraph";

/**
 * Test result interface
 */
export interface TestResult {
  passed: boolean;
  summary?: string;
  output?: string;
}

/**
 * Format result interface
 */
export interface FormatResult {
  success: boolean;
  filesChanged?: number;
  output?: string;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  passed: boolean;
  checks: {
    typescript?: boolean;
    dependencies?: boolean;
    build?: boolean;
  };
  output?: string;
}

/**
 * Linter result interface
 */
export interface LinterResult {
  success: boolean;
  exitCode?: number;
  output?: string;
}

/** Shared LangGraph state for the CodeAgent blueprint (flows between all node kinds). */
export const CodeagentState = Annotation.Root({
  input: Annotation<string>,
  reply: Annotation<string>,
  error: Annotation<string>,
  messages: Annotation<any[]>,
  threadId: Annotation<string | undefined>,
  configurable: Annotation<Record<string, unknown> | undefined>,
  // Agentic node results
  plan: Annotation<string | undefined>,
  fixAttempt: Annotation<string | undefined>,
  // Deterministic node results
  testResults: Annotation<TestResult | undefined>,
  formatResults: Annotation<FormatResult | undefined>,
  linterResults: Annotation<LinterResult | undefined>,
  validationResults: Annotation<ValidationResult | undefined>,
  // Iteration tracking for failure loops
  iterations: Annotation<number>,
});

export type CodeagentStateType = typeof CodeagentState.State;
