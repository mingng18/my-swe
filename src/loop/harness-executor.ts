import type { AgentExecutor } from "../blueprints/compiler";
import type { AgentHarness, AgentInvokeOptions } from "../harness";

/**
 * Adapts the pluggable AgentHarness to BlueprintCompiler's AgentExecutor.
 * Pure delegation — per-iteration feedback and iteration counting are handled
 * by the compiler's agent node (which has graph-state access).
 */
export function createHarnessAgentExecutor(
  getHarness: () => Promise<AgentHarness>,
  opts: AgentInvokeOptions = {},
): AgentExecutor {
  return {
    execute: async (input, _config) => {
      const harness = await getHarness();
      const res = await harness.run(input, {
        threadId: opts.threadId,
        userId: opts.userId,
        transport: opts.transport,
      });
      // Empty-string reply is treated as "no reply" so the error text can
      // surface (nullish-coalescing alone would keep the empty string).
      const output = res.reply ? res.reply : (res.error ?? "(empty reply)");
      return {
        output,
        messages: res.messages ?? [],
      };
    },
  };
}
