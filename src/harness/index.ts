import type { AgentHarness } from "./agentHarness";

export type AgentProvider = "opencode" | "deepagents";

function getProviderFromEnv(): AgentProvider {
  const raw = (process.env.AGENT_PROVIDER || "opencode").trim().toLowerCase();
  if (raw === "deepagents") return "deepagents";
  return "opencode";
}

/**
 * Provider-agnostic harness factory.
 *
 * Clean-architecture boundary: graph nodes should import from `src/harness/index.ts`
 * only, never from provider adapters directly.
 */
export async function getAgentHarness(
  workspaceRoot?: string,
): Promise<AgentHarness> {
  const provider = getProviderFromEnv();
  if (provider === "deepagents") {
    const mod = await import("./deepagents");
    return mod.getAgentHarness(workspaceRoot);
  }

  const mod = await import("./opencode");
  return mod.getAgentHarness(workspaceRoot);
}

export async function initAgentProviderAtStartup(): Promise<void> {
  const provider = getProviderFromEnv();
  if (provider === "deepagents") {
    const mod = await import("./deepagents");
    return mod.initDeepAgentsAtStartup();
  }

  const mod = await import("./opencode");
  return mod.initOpenCodeAtStartup();
}

export async function cleanupAgentProvider(): Promise<void> {
  const provider = getProviderFromEnv();
  if (provider === "deepagents") {
    const mod = await import("./deepagents");
    return mod.cleanupDeepAgents();
  }

  const mod = await import("./opencode");
  return mod.cleanupOpenCode();
}

