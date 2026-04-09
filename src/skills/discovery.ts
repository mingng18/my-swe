import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { createLogger } from "../utils/logger";
import { parseYamlFrontmatter, stripFrontmatter } from "../utils/yaml";
import type { Skill } from "./types";

const logger = createLogger("skills:discovery");

export async function discoverSkills(rootDir: string): Promise<Skill[]> {
  const skillsDir = join(rootDir, ".agents", "skills");

  if (!existsSync(skillsDir)) {
    logger.debug(`[skills] No .agents/skills directory in ${rootDir}`);
    return [];
  }

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const skillPath = join(skillsDir, entry.name);
    const skillFile = join(skillPath, "SKILL.md");

    if (!existsSync(skillFile)) continue;

    try {
      const skill = await parseSkillFile(skillFile, skillPath);
      if (skill) skills.push(skill);
    } catch (err) {
      logger.warn({ err, skill: entry.name }, "[skills] Parse error");
    }
  }

  logger.info({ discovered: skills.length }, "[skills] Discovery completed");
  return skills;
}

async function parseSkillFile(
  filePath: string,
  baseDir: string,
): Promise<Skill | null> {
  const content = await Bun.file(filePath).text();

  const frontmatterMatch = content.match(/^---\n(.*?)\n---/s);
  if (!frontmatterMatch) {
    logger.warn({ path: filePath }, "[skills] No YAML frontmatter found");
    return null;
  }

  const frontmatter = parseYamlFrontmatter(frontmatterMatch[1]);

  if (!frontmatter.name || !frontmatter.description) {
    logger.warn({ path: filePath }, "[skills] Missing required fields");
    return null;
  }

  const body = stripFrontmatter(content);

  return {
    name: frontmatter.name as string,
    description: frontmatter.description as string,
    version: frontmatter.version as string | undefined,
    location: filePath,
    baseDir,
    frontmatter,
    body,
  };
}
