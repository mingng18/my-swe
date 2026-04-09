/**
 * Skill types for Agent Skills support.
 * Based on https://agentskills.io/specification
 */

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  context?: "inline" | "fork";
  disableModelInvocation?: boolean;
  model?: string;
  allowedTools?: string[];
  effort?: number;
  source?: "bundled" | "plugin" | "local";
  kind?: string;
  compatibility?: string[];
}

export interface Skill {
  name: string;
  description: string;
  version?: string;
  location: string;
  baseDir: string;
  frontmatter: SkillFrontmatter;
  body?: string;
}

export interface SkillRegistryEntry {
  skill: Skill;
  activatedAt?: Date;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  location: string;
}
