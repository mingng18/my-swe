/**
 * Event-driven hooks: configuration loader.
 *
 * The hooks config is loaded from one of (in priority order):
 *   1. An explicit config object passed programmatically
 *   2. A JSON file referenced by the `HOOKS_CONFIG_FILE` env var
 *   3. A JSON string in the `HOOKS_CONFIG` env var
 *   4. A `hooks.json` file at the repo root
 *
 * If no config is found, an empty (disabled) config is returned and the
 * dispatcher becomes a no-op.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "../utils/logger";
import type { HooksConfig, HookEntry, HookEvent } from "./types";

const logger = createLogger("hooks-config");

const VALID_EVENTS: HookEvent[] = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
];

/**
 * Validate and normalize a raw parsed config object. Throws on structural
 * errors so misconfiguration fails fast and visibly.
 */
export function validateHooksConfig(raw: unknown): HooksConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("hooks config must be an object");
  }
  const obj = raw as Record<string, unknown>;

  const handlers = obj.handlers;
  if (!Array.isArray(handlers)) {
    throw new Error("hooks config 'handlers' must be an array");
  }

  const validatedHandlers: HookEntry[] = handlers.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`hooks handler[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;

    if (typeof e.name !== "string" || e.name.length === 0) {
      throw new Error(`hooks handler[${i}].name must be a non-empty string`);
    }

    const events = e.events;
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error(
        `hooks handler[${i}] (${e.name}) 'events' must be a non-empty array`,
      );
    }
    for (const ev of events) {
      if (!VALID_EVENTS.includes(ev as HookEvent)) {
        throw new Error(
          `hooks handler[${i}] (${e.name}) has invalid event '${String(ev)}' (valid: ${VALID_EVENTS.join(", ")})`,
        );
      }
    }

    if (e.tools !== undefined && !Array.isArray(e.tools)) {
      throw new Error(
        `hooks handler[${i}] (${e.name}) 'tools' must be an array of strings`,
      );
    }

    const handler = e.handler;
    if (typeof handler !== "object" || handler === null) {
      throw new Error(
        `hooks handler[${i}] (${e.name}) must define a 'handler' object`,
      );
    }
    const h = handler as Record<string, unknown>;
    if (h.type !== "shell" && h.type !== "mcp_tool") {
      throw new Error(
        `hooks handler[${i}] (${e.name}) handler.type must be 'shell' or 'mcp_tool'`,
      );
    }
    if (h.type === "shell" && typeof h.command !== "string") {
      throw new Error(
        `hooks handler[${i}] (${e.name}) shell handler requires a 'command' string`,
      );
    }
    if (h.type === "mcp_tool" && (typeof h.server !== "string" || typeof h.tool !== "string")) {
      throw new Error(
        `hooks handler[${i}] (${e.name}) mcp_tool handler requires 'server' and 'tool' strings`,
      );
    }

    return {
      name: e.name,
      events: events as HookEvent[],
      tools: Array.isArray(e.tools) ? (e.tools as string[]) : undefined,
      enabled: e.enabled === undefined ? true : Boolean(e.enabled),
      handler: h as unknown as HookEntry["handler"],
    };
  });

  return {
    enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
    agent_id: typeof obj.agent_id === "string" ? obj.agent_id : "bullhorse",
    agent_type:
      typeof obj.agent_type === "string" ? obj.agent_type : "deepagents",
    handlers: validatedHandlers,
  };
}

/**
 * Attempt to load the hooks config from the default discovery sources.
 * Returns null when no config source is available (hooks disabled).
 */
function loadConfigFromSources(): unknown | null {
  // 1. Explicit env file path
  const envFile = process.env.HOOKS_CONFIG_FILE;
  if (envFile && existsSync(envFile)) {
    logger.debug({ path: envFile }, "[hooks-config] loading from HOOKS_CONFIG_FILE");
    return JSON.parse(readFileSync(resolve(envFile), "utf-8"));
  }

  // 2. Inline JSON env var
  const envJson = process.env.HOOKS_CONFIG;
  if (envJson && envJson.trim().length > 0) {
    logger.debug("[hooks-config] loading from HOOKS_CONFIG env var");
    return JSON.parse(envJson);
  }

  // 3. hooks.json at repo root / cwd
  const localPath = resolve(process.cwd(), "hooks.json");
  if (existsSync(localPath)) {
    logger.debug({ path: localPath }, "[hooks-config] loading local hooks.json");
    return JSON.parse(readFileSync(localPath, "utf-8"));
  }

  return null;
}

/**
 * Load and validate the hooks config. On any load/parse error, logs a warning
 * and returns a disabled (empty) config rather than throwing — a malformed
 * hooks config must never break the agent.
 */
export function loadHooksConfig(explicit?: HooksConfig): HooksConfig {
  if (explicit) {
    return validateHooksConfig(explicit);
  }

  try {
    const raw = loadConfigFromSources();
    if (raw === null) {
      return { enabled: false, agent_id: "bullhorse", agent_type: "deepagents", handlers: [] };
    }
    return validateHooksConfig(raw);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: errorMsg },
      "[hooks-config] failed to load hooks config, disabling hooks",
    );
    return { enabled: false, agent_id: "bullhorse", agent_type: "deepagents", handlers: [] };
  }
}

/** An empty, disabled config — used as the safe default. */
export const EMPTY_HOOKS_CONFIG: HooksConfig = {
  enabled: false,
  agent_id: "bullhorse",
  agent_type: "deepagents",
  handlers: [],
};
