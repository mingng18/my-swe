/**
 * Agent Skills Module
 *
 * Provides skill discovery, registry, and catalog functionality
 * for integrating Agent Skills (https://agentskills.io) with Bullhorse.
 *
 * @module skills
 */

// Types
export type {
  Skill,
  SkillFrontmatter,
  SkillRegistryEntry,
  SkillCatalogEntry,
} from "./types";

// Discovery
export { discoverSkills } from "./discovery";

// Registry
export { SkillRegistry, skillRegistry } from "./registry";

// Catalog
export { buildSkillCatalog } from "./catalog";
