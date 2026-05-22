/**
 * Agent harness implementation - the abstraction layer between LangGraph and pluggable agent backends.
 *
 * This file acts as the public API for the \`deepagents\` implementation.
 * The core logic has been split into smaller modules under \`src/harness/deepagents/\` for better maintainability.
 */

// Re-export core events
export { emitTodoEvent, emitStreamEvent } from "./deepagents/events";

// Re-export trace utilities
export { shouldTraceAgentToTerminal, runDeepAgentWithStreamTrace } from "./deepagents/trace";

// Re-export sandbox utilities
export {
  extractRepoFromInput,
  getSandboxProfileFromEnv,
  acquireDaytonaSandboxForThreadRepo,
  resolveSandboxContext,
} from "./deepagents/sandbox";

// Re-export factory
export { createAgentInstance } from "./deepagents/factory";

// Re-export lifecycle management
export {
  cleanupThreadMaps,
  initDeepAgentsAtStartup,
  cleanupDeepAgents,
  resetDeepAgentsStateForTesting,
  getThreadRepoMapForTesting,
  hasLoadedPersistedRepos,
} from "./deepagents/lifecycle";

// Re-export wrapper and harness factory
export { DeepAgentWrapper, getAgentHarness } from "./deepagents/wrapper";
