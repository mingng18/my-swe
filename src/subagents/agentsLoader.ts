import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import type { SubAgent } from "deepagents";
import { filterToolsByName } from "./toolFilter";

interface AgentsMdMetadata {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
}

export async function loadRepoAgents(
  agentsDir: string = ".agents/agents",
): Promise<SubAgent[]> {
  const agents: SubAgent[] = [];

  try {
    const files = readdirSync(agentsDir);
    for (const file of files) {
      if (file.endsWith(".md")) {
        const content = readFileSync(join(agentsDir, file), "utf8");
        const agent = parseAgentsMd(content, file);
        if (agent) {
          agents.push(agent);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or isn't readable - that's fine
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[agentsLoader] Error reading agents directory: ${err}`);
    }
  }

  return agents;
}

export function parseAgentsMd(
  content: string,
  filename: string,
): SubAgent | null {
  try {
    const match = content.match(/^---\n([\s\S]+?)\n---/);
    if (!match) {
      console.warn(`[agentsLoader] No YAML frontmatter found in ${filename}`);
      return null;
    }

    const metadata = parse(match[1]) as AgentsMdMetadata;

    // Validate required fields
    if (!metadata.name || !metadata.description) {
      console.warn(
        `[agentsLoader] Missing required fields in ${filename}`,
        metadata,
      );
      return null;
    }

    const systemPrompt = content.slice(match[0].length).trim();

    if (!systemPrompt) {
      console.warn(`[agentsLoader] Empty system prompt in ${filename}`);
      return null;
    }

    return {
      name: metadata.name,
      description: metadata.description,
      systemPrompt,
      tools: filterToolsByName(metadata.tools, metadata.disallowedTools),
      model: metadata.model || "inherit",
    };
  } catch (err) {
    console.error(`[agentsLoader] Failed to parse ${filename}:`, err);
    return null;
  }
}

export function mergeSubagents(
  builtIn: SubAgent[],
  repo: SubAgent[],
): SubAgent[] {
  const merged = [...builtIn];
  const seenNames = new Set(builtIn.map((a) => a.name));

  for (const repoAgent of repo) {
    if (seenNames.has(repoAgent.name)) {
      console.warn(
        `[subagent] Repo agent "${repoAgent.name}" overrides built-in agent`,
      );
      const idx = merged.findIndex((a) => a.name === repoAgent.name);
      if (idx !== -1) merged.splice(idx, 1);
    }
    merged.push(repoAgent);
    seenNames.add(repoAgent.name);
  }

  return merged;
}
