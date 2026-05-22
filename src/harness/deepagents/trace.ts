import { createLogger } from "../../utils/logger";
import { type DeepAgent } from "deepagents";

const logger = createLogger("deepagents");
const AGENT_RECURSION_LIMIT = Number.parseInt(process.env.AGENT_RECURSION_LIMIT || "1000", 10);

/**
 * When true, DeepAgents runs via LangGraph stream() and prints graph steps, tool calls,
 * and streamed LLM tokens to stderr. User-facing channels (Telegram, GitHub, HTTP JSON)
 * still only receive the final harness reply — this is for the operator terminal only.
 *
 * Default: on when stderr is a TTY (local `bun run start`), off in typical Docker/CI.
 * Override: AGENT_TRACE_STDERR=true | false | 1 | 0
 */
export function shouldTraceAgentToTerminal(): boolean {
  const v = process.env.AGENT_TRACE_STDERR?.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return Boolean(process.stderr.isTTY);
}

function trimStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function formatStreamNs(ns: unknown): string {
  if (ns == null) return "main";
  if (Array.isArray(ns)) return ns.length === 0 ? "main" : ns.join(" > ");
  return String(ns);
}

function parseLangGraphStreamChunk(raw: unknown): {
  ns: unknown;
  mode: string;
  payload: unknown;
} | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  if (raw.length >= 3) {
    return { ns: raw[0], mode: String(raw[1]), payload: raw[2] };
  }
  return { ns: null, mode: String(raw[0]), payload: raw[1] };
}

function summarizeUpdateForTrace(node: string, data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const msgs = d.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return "";
  const last = msgs[msgs.length - 1] as Record<string, unknown> | undefined;
  if (!last) return "";
  const toolCalls = last.tool_calls as Array<{ name?: string }> | undefined;
  if (toolCalls?.length) {
    return toolCalls.reduce(
      (acc, t, i) => acc + (i === 0 ? "" : ", ") + (t.name ?? "?"),
      " → ",
    );
  }
  if (last.type === "tool" || last.role === "tool") {
    return ` → tool:${String(last.name ?? "?")}`;
  }
  void node;
  return "";
}

function stringifyPayloadForTrace(data: unknown, max: number): string {
  try {
    return trimStr(JSON.stringify(data), max);
  } catch {
    return trimStr(String(data), max);
  }
}

function messageChunkText(msg: Record<string, unknown>): string {
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part: unknown) => {
        if (!part || typeof part !== "object") return "";
        const p = part as { type?: string; text?: string };
        return p.type === "text" && typeof p.text === "string" ? p.text : "";
      })
      .join("");
  }
  return "";
}

function logAgentTraceChunk(
  ns: unknown,
  mode: string,
  payload: unknown,
  trace: { midLine: boolean; loggedRequests: Set<string> },
): void {
  const src = formatStreamNs(ns);
  if (mode === "updates") {
    if (trace.midLine) {
      process.stderr.write("\n");
      trace.midLine = false;
    }
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const entries = Object.entries(payload as Record<string, unknown>);
      const parts = entries.map(
        ([k, v]) => `${k}${summarizeUpdateForTrace(k, v)}`,
      );
      logger.info(`[agent-trace] [${src}] step: ${parts.join(", ")}`);
    } else {
      logger.info(
        `[agent-trace] [${src}] updates ${stringifyPayloadForTrace(payload, 400)}`,
      );
    }
    return;
  }

  if (mode === "messages") {
    const tuple = payload as [
      Record<string, unknown>?,
      { langgraph_node?: string }?,
    ];
    const msg = tuple?.[0];
    const meta = tuple?.[1];
    if (!msg || typeof msg !== "object") return;
    const node = meta?.langgraph_node ?? "?";

    // Prevent spam: track logged request/node combinations
    // LLM streaming sends many chunks; only log the first occurrence
    const requestKey = `${src}:${node}`;
    const isFirstOccurrence = !trace.loggedRequests.has(requestKey);
    trace.loggedRequests.add(requestKey);

    const toolChunks = msg.tool_call_chunks as
      | Array<{ name?: string; args?: string }>
      | undefined;
    if (toolChunks?.length) {
      if (trace.midLine) {
        process.stderr.write("\n");
        trace.midLine = false;
      }
      for (const tc of toolChunks) {
        if (tc.name)
          logger.info(`[agent-trace] [${src}] tool-call: ${tc.name}`);
        if (tc.args) process.stderr.write(String(tc.args));
      }
      process.stderr.write("\n");
      return;
    }

    const text = messageChunkText(msg);
    if (text) {
      process.stderr.write(text);
      trace.midLine = true;
      return;
    }

    if (trace.midLine) {
      process.stderr.write("\n");
      trace.midLine = false;
    }

    const role = msg.type ?? msg.role ?? "message";
    const name = msg.name;
    if (role === "tool" || String(msg.constructor?.name) === "ToolMessage") {
      const body =
        typeof msg.content === "string"
          ? msg.content
          : stringifyPayloadForTrace(msg.content, 200);
      logger.info(
        `[agent-trace] [${src}] tool-result (${String(name ?? "?")} @${node}): ${trimStr(body, 240)}`,
      );
      return;
    }

    // Only log the first occurrence of each request to prevent spam
    // LLM streaming sends many chunks; subsequent chunks are handled above (text/tool)
    if (isFirstOccurrence) {
      logger.info(`[agent-trace] [${src}] ${String(role)} @${node}`);
    }
    return;
  }

  if (trace.midLine) {
    process.stderr.write("\n");
    trace.midLine = false;
  }
  console.error(
    `[agent-trace] [${src}] ${mode} ${stringifyPayloadForTrace(payload, 280)}`,
  );
}

/**
 * Same end state as invoke(), with optional stderr trace of updates + LLM message chunks.
 */
export async function runDeepAgentWithStreamTrace(
  agent: DeepAgent,
  input: string,
  configurable: Record<string, unknown>,
): Promise<unknown> {
  const stream = await agent.stream(
    { messages: [{ role: "user", content: input }] },
    {
      configurable,
      recursionLimit: AGENT_RECURSION_LIMIT,
      streamMode: ["values", "updates", "messages"],
      subgraphs: true,
    },
  );

  let latest: unknown;
  const trace = { midLine: false, loggedRequests: new Set<string>() };

  for await (const raw of stream) {
    const parsed = parseLangGraphStreamChunk(raw);
    if (!parsed) continue;
    const { ns, mode, payload } = parsed;
    if (mode === "values") {
      latest = payload;
      continue;
    }
    logAgentTraceChunk(ns, mode, payload, trace);
  }

  if (trace.midLine) {
    process.stderr.write("\n");
  }

  if (latest === undefined) {
    const snap = (await agent.getState({ configurable })) as {
      values?: unknown;
    };
    latest = snap.values;
  }

  return latest;
}
