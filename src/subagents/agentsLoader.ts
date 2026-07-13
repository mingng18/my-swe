import { promises as fsPromises } from "fs";
import { join } from "path";
import { parse } from "yaml";
import type { SubAgent } from "deepagents";
import { filterToolsByName } from "./toolFilter";
import { createLogger } from "../utils/logger";

const logger = createLogger("agentsLoader");

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
  try {
    const files = await fsPromises.readdir(agentsDir);
    const mdFiles = files.filter((file) => file.endsWith(".md"));

    const readPromises = mdFiles.map(async (file) => {
      const content = await fsPromises.readFile(join(agentsDir, file), "utf8");
      return parseAgentsMd(content, file);
    });

    const parsedAgents = await Promise.all(readPromises);

    return parsedAgents.filter((agent): agent is SubAgent => agent !== null);
  } catch (err) {
    // Directory doesn't exist or isn't readable - that's fine
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`Error reading agents directory: ${err}`);
    }
    return [];
  }
}

export function parseAgentsMd(
  content: string,
  filename: string,
): SubAgent | null {
  try {
    const match = content.match(/^---\n([\s\S]+?)\n---/);
    if (!match) {
      logger.warn(`No YAML frontmatter found in ${filename}`);
      return null;
    }

    const metadata = parse(match[1]) as AgentsMdMetadata;

    // Validate required fields
    if (!metadata.name || !metadata.description) {
      logger.warn(metadata, `Missing required fields in ${filename}`);
      return null;
    }

    const systemPrompt = content.slice(match[0].length).trim();

    if (!systemPrompt) {
      logger.warn(`Empty system prompt in ${filename}`);
      return null;
    }

    return {
      name: metadata.name,
      description: metadata.description,
      systemPrompt,
      tools: filterToolsByName(metadata.tools, metadata.disallowedTools) as any,
      model: metadata.model || "inherit",
    };
  } catch (err) {
    logger.error(err, `Failed to parse ${filename}:`);
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
      logger.warn(`Repo agent "${repoAgent.name}" overrides built-in agent`);
      const idx = merged.findIndex((a) => a.name === repoAgent.name);
      if (idx !== -1) merged.splice(idx, 1);
    }
    merged.push(repoAgent);
    seenNames.add(repoAgent.name);
  }

  return merged;
}
