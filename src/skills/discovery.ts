import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { createLogger } from "../utils/logger";
import { parseYamlFrontmatter, stripFrontmatter } from "../utils/yaml";
import type { Skill, SkillFrontmatter } from "./types";

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

  // Ensure frontmatter meets SkillFrontmatter type requirements
  const skillFrontmatter: SkillFrontmatter = {
    name: frontmatter.name as string,
    description: frontmatter.description as string,
    version: frontmatter.version as string | undefined,
    context: frontmatter.context as "inline" | "fork" | undefined,
    disableModelInvocation: frontmatter.disableModelInvocation as
      | boolean
      | undefined,
    model: frontmatter.model as string | undefined,
    allowedTools: frontmatter.allowedTools as string[] | undefined,
    effort: frontmatter.effort as number | undefined,
    source: frontmatter.source as "bundled" | "plugin" | "local" | undefined,
    kind: frontmatter.kind as string | undefined,
    compatibility: frontmatter.compatibility as string[] | undefined,
  };

  return {
    name: skillFrontmatter.name,
    description: skillFrontmatter.description,
    version: skillFrontmatter.version,
    location: filePath,
    baseDir,
    frontmatter: skillFrontmatter,
    body,
  };
}
