import { SandboxService } from "../integrations/sandbox-service";

const sandboxByThread = new Map<string, SandboxService>();

/**
 * Get the active sandbox backend from global context.
 * This is set by the DeepAgents harness when using sandbox backend.
 */
export function getSandboxBackendSync(
  threadId: string,
): SandboxService | null {
  if (!threadId) return null;
  return sandboxByThread.get(threadId) || null;
}

export function setSandboxBackend(threadId: string, backend: SandboxService): void {
  if (!threadId) return;
  sandboxByThread.set(threadId, backend);
}

export function clearSandboxBackend(threadId: string): void {
  if (!threadId) return;
  sandboxByThread.delete(threadId);
}
