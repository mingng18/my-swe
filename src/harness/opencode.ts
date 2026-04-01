import { createLogger } from "../utils/logger";
import { loadLlmConfig } from "../utils/config";
import type {
  AgentHarness,
  AgentInvokeOptions,
  AgentResponse,
} from "./agentHarness";

const logger = createLogger("opencode");

type OpenCodeInstance = {
  client: any;
  server?: { url?: string; close: () => void };
};

let instance: OpenCodeInstance | null = null;
const threadSessionMap = new Map<string, string>();

async function canConnectToOpencodeServer(url: string): Promise<boolean> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 600);
  try {
    // We don't care if it's 200 vs 404; we only care that a server answers.
    await fetch(url, { method: "GET", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(id);
  }
}

async function getOpenCodeInstance(): Promise<OpenCodeInstance> {
  if (instance) return instance;

  // Lazy import so the rest of the app stays decoupled.
  const { createOpencode, createOpencodeClient } = await import("@opencode-ai/sdk");

  const { model, openaiApiKey, openaiBaseUrl } = loadLlmConfig();
  // If we're pointing at a non-OpenAI base URL, treat it as an OpenAI-compatible provider.
  // This is the most reliable way to use custom model ids like GLM on Z.ai.
  const isDefaultOpenAi =
    openaiBaseUrl.replace(/\/+$/, "") === "https://api.openai.com/v1";
  const providerId = isDefaultOpenAi ? "openai" : "openai-compatible";

  // OpenCode model format is `provider/model` (e.g. `openai/gpt-4o-mini`).
  const modelStr = model.includes("/") ? model : `${providerId}/${model}`;

  const hostname = process.env.OPENCODE_HOSTNAME || "127.0.0.1";
  const port = process.env.OPENCODE_PORT ? Number(process.env.OPENCODE_PORT) : 4096;
  const url = `http://${hostname}:${port}`;

  // If a server is already running on the configured host/port, reuse it.
  if (await canConnectToOpencodeServer(url)) {
    const client = createOpencodeClient({ baseUrl: url });
    instance = { client };
    logger.info({ url }, "[opencode] Reusing existing server and client ready");
    return instance;
  }

  const started = await createOpencode({
    hostname,
    port,
    timeout: process.env.OPENCODE_START_TIMEOUT_MS
      ? Number(process.env.OPENCODE_START_TIMEOUT_MS)
      : 10_000,
    config: {
      model: modelStr,
      provider: {
        ...(isDefaultOpenAi
          ? {
              openai: {
                options: {
                  baseURL: openaiBaseUrl,
                  apiKey: openaiApiKey,
                },
              },
            }
          : {
              "openai-compatible": {
                npm: "@ai-sdk/openai-compatible",
                name: "OpenAI-compatible",
                options: {
                  baseURL: openaiBaseUrl,
                  apiKey: openaiApiKey,
                },
                models: {
                  [model]: { name: model },
                },
              },
            }),
      },
    },
  });

  instance = { client: started.client, server: started.server };
  logger.info(
    { url: started.server?.url },
    "[opencode] Server started and client ready",
  );
  return instance;
}

async function getOrCreateSessionId(threadId: string): Promise<string> {
  const existing = threadSessionMap.get(threadId);
  if (existing) return existing;

  const { client } = await getOpenCodeInstance();
  const res = await client.session.create({ body: { title: `thread:${threadId}` } });
  const sessionId = res?.data?.id;
  if (!sessionId) {
    throw new Error(
      `OpenCode session.create failed: ${res?.error ? JSON.stringify(res.error) : "no session id"}`,
    );
  }
  threadSessionMap.set(threadId, sessionId);
  return sessionId;
}

function extractTextFromParts(parts: any[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  if (parts.length === 0) return "";
  const textParts = parts
    .filter((p) => p && typeof p === "object" && p.type === "text")
    .map((p) => (typeof p.text === "string" ? p.text : ""));
  const combined = textParts.join("");
  // Only treat actual `text` parts as user-visible output.
  return combined.trim();
}

export class OpenCodeHarness implements AgentHarness {
  async invoke(
    input: string,
    options?: AgentInvokeOptions,
  ): Promise<AgentResponse> {
    const threadId = options?.threadId || "default-session";
    const { client } = await getOpenCodeInstance();
    const sessionId = await getOrCreateSessionId(threadId);

    logger.info(
      { threadId, sessionId, inputLength: input.length },
      "[opencode] prompt",
    );

    try {
      // OpenCode's `prompt` endpoint may return an empty body; use async prompt and
      // poll messages for the assistant reply.
      const sent = await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: input }],
        },
      });

      if (sent?.error) {
        return { reply: "", error: JSON.stringify(sent.error) };
      }

      const timeoutMs = 30_000;
      const startedAt = Date.now();
      let lastMessages: any[] = [];
      let lastAssistantId: string | undefined;

      while (Date.now() - startedAt < timeoutMs) {
        const msgs = await client.session.messages({ path: { id: sessionId } });
        lastMessages = Array.isArray(msgs?.data) ? msgs.data : [];

        const lastAssistant = [...lastMessages]
          .reverse()
          .find((m) => m?.info?.role === "assistant");
        const assistantId = lastAssistant?.info?.id;
        if (typeof assistantId === "string") {
          lastAssistantId = assistantId;
          const full = await client.session.message({
            path: { id: sessionId, messageID: assistantId },
          });
          const reply = extractTextFromParts(full?.data?.parts);
          if (reply && reply.length > 0) {
            return { reply, messages: lastMessages };
          }

          // If the assistant message has completed but produced no `text` parts,
          // treat it as an error so callers don't think the agent "replied".
          const completed = Boolean(full?.data?.info?.time?.completed);
          if (completed) {
            const partTypes = Array.isArray(full?.data?.parts)
              ? full.data.parts.map((p: any) => p?.type).filter(Boolean)
              : [];
            return {
              reply: "",
              error: `OpenCode assistant message completed but had no text parts (partTypes: ${partTypes.join(", ") || "none"})`,
              messages: lastMessages,
            };
          }
        }

        await new Promise((r) => setTimeout(r, 750));
      }

      const roles = lastMessages.map((m) => m?.info?.role).filter(Boolean);
      return {
        reply: "",
        error: `OpenCode prompt timed out after ${timeoutMs}ms (roles: ${roles.join(", ") || "none"}; assistantId: ${lastAssistantId || "none"})`,
        messages: lastMessages,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, threadId, sessionId }, "[opencode] invoke failed");
      return { reply: "", error: msg };
    }
  }

  async run(input: string, options?: AgentInvokeOptions): Promise<AgentResponse> {
    return this.invoke(input, options);
  }

  async *stream(
    input: string,
    options?: AgentInvokeOptions,
  ): AsyncGenerator<any, void, unknown> {
    // Minimal parity: yield a single assistant message for now.
    // We can upgrade to SSE event streaming later via client.event.subscribe().
    const result = await this.invoke(input, options);
    yield { messages: [{ role: "assistant", content: result.reply }] };
  }

  async getState(threadId: string): Promise<any> {
    const { client } = await getOpenCodeInstance();
    const sessionId = threadSessionMap.get(threadId);
    if (!sessionId) return null;
    const res = await client.session.messages({ path: { id: sessionId } });
    return res?.data || null;
  }
}

export async function getAgentHarness(
  _workspaceRoot?: string,
): Promise<AgentHarness> {
  return new OpenCodeHarness();
}

export async function initOpenCodeAtStartup(): Promise<void> {
  await getOpenCodeInstance();
}

export async function cleanupOpenCode(): Promise<void> {
  if (!instance) return;
  try {
    instance.server?.close?.();
  } catch (err) {
    logger.warn({ err }, "[opencode] Failed to close server");
  } finally {
    instance = null;
    threadSessionMap.clear();
  }
}

