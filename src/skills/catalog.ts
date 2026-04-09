import { createLogger } from "../utils/logger";
import type { Skill, SkillCatalogEntry } from "./types";

const logger = createLogger("skills:catalog");

const MAX_DESC_CHARS = 250;

/**
 * Build a skill catalog from discovered skills.
 * Returns an XML-formatted string suitable for system prompt construction.
 *
 * The catalog contains only essential metadata (name, description, location)
 * needed to present available skills to the LLM without overwhelming context.
 *
 * Descriptions are truncated to MAX_DESC_CHARS to control token usage.
 */
export function buildSkillCatalog(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const entries: SkillCatalogEntry[] = [];

  for (const skill of skills) {
    // Skip invalid entries
    if (!skill.name || !skill.description) {
      logger.warn(
        { skill: skill.name, location: skill.location },
        "[catalog] Skipping skill with missing required fields",
      );
      continue;
    }

    const description = skill.frontmatter.description || skill.description;

    entries.push({
      name: skill.name,
      description: truncateDescription(description, MAX_DESC_CHARS),
      location: skill.location,
    });
  }

  logger.debug(
    { total: skills.length, catalog: entries.length },
    "[catalog] Built skill catalog",
  );

  return `
<available_skills>
${entries
  .map(
    (e) => `  <skill>
    <name>${e.name}</name>
    <description>${e.description}</description>
    <location>${e.location}</location>
  </skill>`,
  )
  .join("\n")}
</available_skills>

The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the activate_skill tool
with the skill's name to load its full instructions.
`;
}

/**
 * Truncate description to max characters, appending ellipsis if truncated.
 */
function truncateDescription(desc: string, maxChars: number): string {
  if (desc.length <= maxChars) return desc;
  return desc.slice(0, maxChars - 1) + "…";
}
