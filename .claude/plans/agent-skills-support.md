# Agent Skills Support for Bullhorse

**Date:** 2026-04-10
**Status:** Approved
**Approach:** Progressive Disclosure (Approach A)

## Overview

Add Agent Skills support to Bullhorse so that when working on external repositories (e.g., `--repo mingng18/recipe-rn`), the agent automatically discovers and uses skills from the target repository's `.agents/skills/` directory.

The system follows the **Agent Skills specification** (agentskills.io) with a three-tier progressive disclosure strategy:

| Tier | What's loaded | When | Token cost |
|------|---------------|------|------------|
| 1. Catalog | Name + description | Session start | ~50-100 tokens per skill |
| 2. Instructions | Full SKILL.md body | When skill is activated | <5000 tokens |
| 3. Resources | Scripts, references, assets | When instructions reference them | Varies |

## Architecture

### New Components

```
src/
├── skills/
│   ├── types.ts              # Skill interfaces and types
│   ├── discovery.ts          # Scan and parse SKILL.md files
│   ├── catalog.ts            # Build skill catalog for system prompt
│   ├── registry.ts           # In-memory skill registry (thread-scoped)
│   └── index.ts              # Barrel export
├── tools/
│   └── activate-skill.ts     # Tool to load full skill content
├── middleware/
│   └── skill-compaction-protection.ts  # Protect skill content from compaction
├── harness/
│   └── deepagents.ts         # Modified: add skill discovery
└── prompt.ts                 # Modified: inject catalog into system prompt
```

### Data Flow

1. Agent receives task with `--repo owner/name`
2. `prepareAgent()` clones repo, discovers skills, builds catalog, stores in registry
3. System prompt includes skill catalog with behavioral instructions
4. Agent calls `activate_skill(name)` when skill is relevant
5. Tool returns full skill body wrapped in `<skill_content>` tags
6. Middleware protects skill content from context compaction

### Type Definitions

```typescript
interface Skill {
  name: string;                    // From frontmatter (required)
  description: string;             // From frontmatter (required)
  version?: string;                // From frontmatter (optional)
  location: string;                // Absolute path to SKILL.md
  baseDir: string;                 // Parent directory path
  frontmatter: SkillFrontmatter;   // Full parsed frontmatter
  body?: string;                   // Markdown content (lazy-loaded)
}

interface SkillFrontmatter {
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
```

## Implementation Checklist

**Phase 1: Core Infrastructure**
- [ ] `src/skills/types.ts` - Skill interfaces
- [ ] `src/skills/registry.ts` - Thread-scoped registry
- [ ] `src/skills/discovery.ts` - Discovery and parsing
- [ ] `src/skills/catalog.ts` - Catalog generation
- [ ] `src/skills/index.ts` - Barrel exports

**Phase 2: Tool & Middleware**
- [ ] `src/tools/activate-skill.ts` - activate_skill tool
- [ ] `src/middleware/skill-compaction-protection.ts` - Protection middleware

**Phase 3: Integration**
- [ ] Modify `src/prompt.ts` - Add skill discovery and catalog
- [ ] Modify `src/harness/deepagents.ts` - Add middleware

**Phase 4: Testing**
- [ ] Unit tests for discovery/parsing
- [ ] Unit tests for registry
- [ ] Integration test with mock repo
- [ ] Manual test with real repo

## References

- https://agentskills.io/specification
- https://agentskills.io/llms.txt
- https://js.langchain.com/docs/deepagents/skills
- Claude Code SkillTool implementation
