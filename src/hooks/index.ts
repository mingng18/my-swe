/**
 * Event-driven hooks public surface.
 *
 * Consumers should import from here rather than reaching into individual
 * modules. The only externally-facing wiring point is `createHooksMiddleware`
 * (composed into the DeepAgents middleware pipeline) and `fireSessionStart`
 * (called from the coder node / harness entry).
 */

export type {
  HookEvent,
  HookEventPayload,
  SessionStartPayload,
  ToolEventPayload,
  HookVeto,
  ShellHandlerConfig,
  McpToolHandlerConfig,
  HookHandlerConfig,
  HookEntry,
  HooksConfig,
} from "./types";

export {
  validateHooksConfig,
  loadHooksConfig,
  EMPTY_HOOKS_CONFIG,
} from "./config";

export {
  HooksRegistry,
  isHookVeto,
  type McpToolCaller,
} from "./registry";

export {
  HooksDispatcher,
  getHooksDispatcher,
  resetHooksDispatcher,
  createHooksMiddleware,
  fireSessionStart,
} from "./dispatcher";
