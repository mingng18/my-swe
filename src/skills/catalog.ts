import { createLogger } from "../utils/logger";
import type { Skill, SkillCatalogEntry } from "./types";

const logger = createLogger("skills:catalog");

/**
 * Build a skill catalog from discovered skills.
 * Returns a simplified view suitable for system prompt construction.
 *
 * The catalog contains only essential metadata (name, description, location)
 * needed to present available skills to the LLM without overwhelming context.
 */
export function buildSkillCatalog(skills: Skill[]): SkillCatalogEntry[] {
  const catalog: SkillCatalogEntry[] = [];

  for (const skill of skills) {
    // Skip invalid entries
    if (!skill.name || !skill.description) {
      logger.warn(
        { skill: skill.name, location: skill.location },
        "[catalog] Skipping skill with missing required fields",
      );
      continue;
    }

    catalog.push({
      name: skill.name,
      description: skill.frontmatter.description || skill.description,
      location: skill.location,
    });
  }

  logger.debug(
    { total: skills.length, catalog: catalog.length },
    "[catalog] Built skill catalog",
  );

  return catalog;
}
