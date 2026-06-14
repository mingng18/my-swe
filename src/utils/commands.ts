/**
 * User-facing command dispatcher + extensible registry (#498 family).
 *
 * Bullhorse's Telegram path (src/index.ts) forwards every message to the
 * coding agent. This module intercepts a set of slash commands and answers
 * them directly — without consuming an agent turn.
 *
 * Commands are registered in a `registry`, so new commands (built-in or
 * user-defined) are added via `registerCommand(...)` rather than a hardcoded
 * switch. Unknown slash commands and ordinary messages are NOT intercepted
 * ({ handled: false }) so they flow through to the agent unchanged.
 */
import { getThreadMetrics } from "./telemetry";
import { getAgentHarness } from "../harness";
import { threadManager } from "../harness/thread-manager";
import { getMode, setMode, getModelOverride, setModelOverride } from "./session-store";

export interface CommandResult {
  /** true when the message was a known command and was answered here. */
  handled: boolean;
  /** the reply text when handled. */
  reply?: string;
}

/** A command handler receives the raw args (after the command) and the threadId. */
export type CommandHandler = (
  args: string,
  threadId: string,
) => Promise<string> | string;

interface CommandDef {
  description: string;
  handler: CommandHandler;
}

const registry = new Map<string, CommandDef>();

const TELEGRAM_REPLY_CAP = 4000;

/** Register (or replace) a slash command. The command must include the leading "/". */
export function registerCommand(
  cmd: string,
  description: string,
  handler: CommandHandler,
): void {
  registry.set(cmd, { description, handler });
}

/** All registered commands, for /help and discovery. */
export function listCommands(): { cmd: string; description: string }[] {
  return [...registry.entries()].map(([cmd, def]) => ({
    cmd,
    description: def.description,
  }));
}

/** Parse a leading slash command, stripping an optional @botname suffix. */
export function tokenize(text: string): { cmd: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const firstSpace = trimmed.search(/\s/);
  const rawCmd = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
  const cmd = rawCmd.replace(/@.+$/, "");
  const args = firstSpace === -1 ? "" : trimmed.slice(firstSpace).trim();
  return { cmd, args };
}

/** True iff `text` is one of the commands this dispatcher will answer. */
export function isCommand(text: string): boolean {
  const t = tokenize(text);
  return t !== null && registry.has(t.cmd);
}

/**
 * Handle a slash command if `text` is one we own. Never throws — command
 * failures are returned as a friendly reply so the user is never left hanging.
 */
export async function handleCommand(
  text: string,
  threadId: string,
): Promise<CommandResult> {
  const t = tokenize(text);
  if (!t || !registry.has(t.cmd)) return { handled: false };
  try {
    const def = registry.get(t.cmd)!;
    const reply = await def.handler(t.args, threadId);
    return { handled: true, reply };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { handled: true, reply: `Command failed: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Built-in commands
// ---------------------------------------------------------------------------

function helpText(): string {
  const lines = ["*Bullhorse commands*", ""];
  for (const { cmd, description } of listCommands()) {
    lines.push(`${cmd} — ${description}`);
  }
  lines.push("", "Anything else is sent to the coding agent.");
  return lines.join("\n");
}

function usageText(threadId: string): string {
  const m = getThreadMetrics(threadId);
  const llm = m.llmCalls;
  const lines = [
    `*Usage for thread* \`${threadId}\``,
    "",
    `LLM calls: ${llm.count}`,
    `Tokens: ${llm.totalTokens} (in ${llm.totalInputTokens} / out ${llm.totalOutputTokens})`,
    `Model: ${llm.model || "n/a"}`,
    `Avg latency: ${Math.round(llm.avgLatency)} ms`,
    `Wall time: ${(m.totalDuration / 1000).toFixed(1)} s`,
  ];
  const toolNames = Object.keys(m.tools);
  if (toolNames.length) {
    lines.push("", "Tools:");
    for (const name of toolNames) {
      const tt = m.tools[name];
      lines.push(`  ${name}: ${tt.count}× (${Math.round(tt.successRate * 100)}% ok)`);
    }
  }
  return lines.join("\n");
}

async function exportText(threadId: string): Promise<string> {
  const harness = await getAgentHarness();
  const state = (await harness.getState(threadId)) as {
    values?: { messages?: any[] };
    messages?: any[];
  };
  const messages = state?.values?.messages ?? state?.messages ?? [];
  if (!messages.length) {
    return `No conversation found for thread \`${threadId}\`.`;
  }
  const lines = [
    `*Export for thread* \`${threadId}\` (${messages.length} messages)`,
    "",
  ];
  for (const msg of messages) {
    const role = typeof msg?.role === "string" ? msg.role : (msg?._getType?.() ?? "unknown");
    const rawContent = typeof msg?.content === "string" ? msg.content : JSON.stringify(msg?.content ?? "");
    const body = rawContent.length > 500 ? rawContent.slice(0, 500) + "…" : rawContent;
    lines.push(`[${role}] ${body}`);
  }
  const out = lines.join("\n");
  return out.length > TELEGRAM_REPLY_CAP
    ? out.slice(0, TELEGRAM_REPLY_CAP) + "\n…(truncated)"
    : out;
}

function planHandler(args: string, threadId: string): string {
  setMode(threadId, "plan");
  return "Plan mode *ON* for this thread. I'll read the code and propose a plan without making changes. Send the task; run /act when you're ready to apply.";
}

function actHandler(args: string, threadId: string): string {
  setMode(threadId, "act");
  return "Act mode *ON* — I'll make changes as usual.";
}

function modelHandler(args: string, threadId: string): string {
  const model = args.trim();
  if (!model) {
    const current = getModelOverride(threadId);
    return current
      ? `Current model for this thread: \`${current}\`. Usage: /model <name> (or /model default to clear).`
      : "No per-thread model override — using the global MODEL. Usage: /model <name>.";
  }
  if (model === "default" || model === "reset") {
    setModelOverride(threadId, undefined);
    threadManager.clearAgent(threadId); // rebuild on next turn with the global MODEL
    return "Per-thread model override cleared — using the global MODEL.";
  }
  setModelOverride(threadId, model);
  threadManager.clearAgent(threadId); // rebuild on next turn with the new model
  return `Model for this thread set to \`${model}\`. It applies on the next turn.`;
}

// Register built-ins (module-load). Order matters only for /help display.
registerCommand("/help", "show this help", () => helpText());
registerCommand("/usage", "token + cost usage for this thread", (_a, tid) => usageText(tid));
registerCommand("/export", "export this thread's conversation", (_a, tid) => exportText(tid));
registerCommand("/plan", "plan mode: propose a plan, no edits", planHandler);
registerCommand("/act", "act mode: make changes (default)", actHandler);
registerCommand("/model", "set the model for this thread (/model <name>)", modelHandler);
