/**
 * Loop detection middleware for DeepAgents.
 *
 * Uses `createMiddleware` from langchain to inject into the DeepAgent's
 * internal model-call loop. Before each model call, inspects recent messages
 * for repeated identical tool calls. After a threshold, injects a corrective
 * system message. After a hard limit, forces the model to stop searching.
 */

import { createMiddleware } from "langchain";
import { createLogger } from "../utils/logger";

const logger = createLogger("loop-detection");

/** How many consecutive identical tool-call rounds before injecting a warning. */
const WARN_THRESHOLD = 3;
/** How many consecutive identical tool-call rounds before force-injecting a hard stop. */
const HARD_STOP_THRESHOLD = 5;

/**
 * Build a fingerprint for a single tool call: name + sorted JSON of args.
 */
function toolCallFingerprint(tc: { name?: string; args?: unknown }): string {
  const name = tc.name ?? "unknown";
  let argsKey: string;
  try {
    const args = (tc.args ?? {}) as Record<string, unknown>;
    argsKey = JSON.stringify(args, Object.keys(args).sort());
  } catch {
    argsKey = String(tc.args);
  }
  return `${name}::${argsKey}`;
}

/**
 * Build a fingerprint for a model turn (all tool calls in one AI message).
 */
function turnFingerprint(
  toolCalls: Array<{ name?: string; args?: unknown }>,
): string {
  return toolCalls.reduce((acc, tc, i) => {
    return i === 0
      ? toolCallFingerprint(tc)
      : acc + "|" + toolCallFingerprint(tc);
  }, "");
}

/**
 * Scan recent messages to count consecutive identical tool-call turns.
 *
 * Walks backward through `messages` looking for AI messages with tool_calls.
 * Counts how many consecutive AI messages have the same tool-call fingerprint
 * as the most recent one.
 */
function countConsecutiveRepeats(messages: Array<Record<string, unknown>>): {
  count: number;
  fingerprint: string | null;
} {
  // Collect fingerprints of recent AI-message tool-call turns, newest first.
  const fingerprints: string[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const toolCalls = msg.tool_calls as
      | Array<{ name?: string; args?: unknown }>
      | undefined;

    // AI message with tool calls — record its fingerprint
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      fingerprints.push(turnFingerprint(toolCalls));
      continue;
    }

    // Tool result messages — skip (they sit between AI messages)
    if (msg.type === "tool" || msg.role === "tool") {
      continue;
    }

    // Any other message type (human, system) — stop scanning
    break;
  }

  if (fingerprints.length === 0) {
    return { count: 0, fingerprint: null };
  }

  const latest = fingerprints[0];
  let count = 0;
  for (const fp of fingerprints) {
    if (fp === latest) {
      count++;
    } else {
      break;
    }
  }

  return { count, fingerprint: latest };
}

/**
 * Create a DeepAgents-compatible middleware that detects and breaks
 * tool-call loops.
 *
 * Pass this to `createDeepAgent({ middleware: [createLoopDetectionMiddleware()] })`.
 */
export function createLoopDetectionMiddleware() {
  return createMiddleware({
    name: "loopDetectionMiddleware",

    wrapModelCall: async (request: any, handler: any) => {
      const messages = request.messages as Array<Record<string, unknown>>;
      if (!messages || messages.length < 4) {
        return handler(request);
      }

      const { count, fingerprint } = countConsecutiveRepeats(messages);

      if (count >= HARD_STOP_THRESHOLD) {
        logger.error(
          { count, fingerprint },
          "[loop-detection] Hard stop: agent stuck in infinite loop",
        );

        // Inject an extremely directive system message as a human message
        // to force the model to change behavior
        const stopMessage = {
          role: "user" as const,
          content:
            `[SYSTEM OVERRIDE] You have repeated the EXACT same tool call ${count} times. ` +
            "This is an infinite loop. You MUST take a DIFFERENT action NOW. " +
            "Options: (1) Use `edit_file` to modify the code you found. " +
            "(2) Use `write_file` to create/overwrite a file. " +
            "(3) Use `commit_and_open_pr` if changes are already made. " +
            "DO NOT call the same search/grep tool again.",
        };

        return handler({
          ...request,
          messages: [...messages, stopMessage],
        });
      }

      if (count >= WARN_THRESHOLD) {
        logger.warn(
          { count, fingerprint },
          "[loop-detection] Repeated identical tool calls detected",
        );

        const warnMessage = {
          role: "user" as const,
          content:
            `[SYSTEM] You have called the same tool with identical arguments ${count} times consecutively. ` +
            "Stop searching and act on what you already found. " +
            "If you found the target code, use `edit_file` to make the change. " +
            "Do NOT repeat the same search.",
        };

        return handler({
          ...request,
          messages: [...messages, warnMessage],
        });
      }

      return handler(request);
    },
  });
}
