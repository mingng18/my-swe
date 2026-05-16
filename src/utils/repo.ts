import { type SandboxProfile } from "../integrations/daytona-pool.js";

export function getSandboxProfileFromEnv(): SandboxProfile {
  const p = (process.env.SANDBOX_PROFILE || "typescript").trim().toLowerCase();
  if (
    p === "typescript" ||
    p === "javascript" ||
    p === "python" ||
    p === "java" ||
    p === "polyglot"
  ) {
    return p as SandboxProfile;
  }
  return "typescript";
}

export function extractRepoFromInput(
  input: string,
): { owner: string; name: string; workspaceDir: string } | undefined {
  const match = input.match(/--repo\s+([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)/);
  if (!match) return undefined;

  const repoStr = match[1].replace(/[.,;!?]+$/, "");

  const defaultOwner = process.env.GITHUB_DEFAULT_OWNER || "";
  if (!repoStr.includes("/")) {
    if (!defaultOwner) return undefined;
    return {
      owner: defaultOwner,
      name: repoStr,
      workspaceDir: `/workspace/${repoStr}`,
    };
  }

  const [owner, name] = repoStr.split("/", 2);
  return { owner, name, workspaceDir: `/workspace/${name}` };
}
