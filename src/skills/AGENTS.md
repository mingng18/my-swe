# AGENTS.md for `src/skills/`

## Package Identity

Agent Skills integration - external skill marketplace support for reusable agent instructions.
Discovers skills from `.agents/skills/` directories and provides a lightweight catalog for the agent system prompt.
Skills are loaded on-demand via `activate_skill` tool call to reduce context size.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Enable skills: `SKILLS_ENABLED=true` (default)
- Run with skills: `bun run start`
- Test skill discovery: `bun test src/skills/__tests__/`

## Patterns & Conventions

- ✅ DO: Define skills in `.agents/skills/<skill-name>/SKILL.md` or `.agents/skills/<skill-name>.md`.
- ✅ DO: Use YAML frontmatter for skill metadata: `name`, `description`, `version`, `tags`.
- ✅ DO: Keep skill content concise and actionable; avoid copying entire CLAUDE.md.
- ✅ DO: Register skills in `SkillRegistry` per-thread for activation tracking.
- ✅ DO: Use `activate_skill` tool to load full skill content on-demand.
- ✅ DO: Protect activated skills from context compaction via `skillCompactionProtectionMiddleware`.
- ❌ DON'T: Load all skills into system prompt at startup; use JIT catalog approach.
- ❌ DON'T: Put skill implementation code in skill files; skills are instructions only.
- ❌ DON'T: Create skills for one-time tasks; skills are for reusable patterns.

## Touch Points / Key Files

- Skill types: `src/skills/types.ts`
- Skill discovery: `src/skills/discovery.ts`
- Skill registry: `src/skills/registry.ts`
- Skill catalog: `src/skills/catalog.ts`
- Main skills index: `src/skills/index.ts`

## JIT Index Hints

- Find skill definitions: `rg -n "^---$|name:|description:" .agents/skills`
- Find skill activation: `rg -n "activate_skill|skillRegistry|markActivated" src/skills src/tools`
- Find catalog references: `rg -n "skillCatalog|SKILLS_ENABLED" src/skills src/harness/deepagents.ts`
- List all skills: `find .agents/skills -name "*.md" -o -name "SKILL.md"`

## Common Gotchas

- Skills are discovered from `.agents/skills/` at startup; changes require restart.
- The skill catalog in the system prompt is lightweight; full content loads on-demand.
- Activated skills are protected from context compaction; don't activate unless needed.
- Skill names must be unique; duplicates are logged but not prevented.
- The `activate_skill` tool returns skill content as a tool result; agent must read and follow it.

## Pre-PR Checks

`bunx tsc --noEmit && bun test src/skills/__tests__/ && bun run start`
