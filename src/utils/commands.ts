/**
 * User-facing Telegram command dispatcher (#498 family).
 *
 * Bullhorse's Telegram path (src/index.ts) previously forwarded every message
 * straight to the coding agent. This module intercepts a small set of slash
 * commands (/usage, /export, /help) and answers them directly — without
 * consuming an agent turn — so users get instant, visible controls.
 *
 * Unknown commands and ordinary messages are NOT intercepted (returned as
 * { handled: false }) so they flow through to the agent unchanged.
 *
 * The harness-integrated commands (/plan, /act, /model, …) and the full
 * slash-commands framework build on this dispatcher.
 */
import { getThreadMetrics } from "./telemetry";
import { getAgentHarness } from "../harness";

export interface CommandResult {
  /** true when the message was a known command and was answered here. */
  handled: boolean;
  /** the reply text when handled. */
  reply?: string;
}

/** Commands this dispatcher owns. Anything else passes through to the agent. */
const KNOWN_COMMANDS = new Set(["/usage", "/export", "/help"]);

/** Max chars we push into a single Telegram reply. */
const TELEGRAM_REPLY_CAP = 4000;

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
  return t !== null && KNOWN_COMMANDS.has(t.cmd);
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
  if (!t || !KNOWN_COMMANDS.has(t.cmd)) return { handled: false };

  try {
    switch (t.cmd) {
      case "/help":
        return { handled: true, reply: helpText() };
      case "/usage":
        return { handled: true, reply: usageText(threadId) };
      case "/export":
        return { handled: true, reply: await exportText(threadId) };
      default:
        return { handled: false };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { handled: true, reply: `Command failed: ${msg}` };
  }
}

function helpText(): string {
  return [
    "*Bullhorse commands*",
    "",
    "/usage — token + cost usage for this thread",
    "/export — export this thread's conversation",
    "/help — show this help",
    "",
    "Anything else is sent to the coding agent.",
  ].join("\n");
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
