# Agent Skills Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Agent Skills support to Bullhorse so agents can discover and use skills from target repositories' `.agents/skills/` directories

**Architecture:** Progressive disclosure with 3 tiers: (1) skill catalog in system prompt at session start, (2) full skill content loaded via `activate_skill` tool on demand, (3) supporting files loaded as referenced. Thread-scoped registry tracks activated skills and protects them from context compaction.

**Tech Stack:** TypeScript, Bun, LangChain DeepAgents, Zod (validation), YAML (frontmatter parsing)

---

## Task 1: Create Skill Types

**Files:**
- Create: `src/skills/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/types.ts
git commit -m "feat(skills): add Skill types and interfaces"
```

---

## Task 2: Create YAML Parsing Utilities

**Files:**
- Create: `src/utils/yaml.ts`

- [ ] **Step 1: Create YAML utilities**

```typescript
import { parse as parseYaml } from "yaml";

export function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
  try {
    return parseYaml(yaml) as Record<string, unknown>;
  } catch (err) {
    const fixed = fixCommonYamlIssues(yaml);
    return parseYaml(fixed) as Record<string, unknown>;
  }
}

function fixCommonYamlIssues(yaml: string): string {
  return yaml.split("\n").map((line) => {
    const match = line.match(/^(\w+):\s*(.+?:.*)$/);
    if (match && !match[2].startsWith('"')) {
      return `${match[1]}: ${JSON.stringify(match[2])}`;
    }
    return line;
  }).join("\n");
}

export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n(.*?)\n---/s);
  if (!match) return content;
  return content.slice(match[0].length).trim();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/yaml.ts
git commit -m "feat(utils): add YAML parsing utilities for skills"
```

---

## Task 3: Create Skill Discovery

**Files:**
- Create: `src/skills/discovery.ts`
- Create: `src/skills/__tests__/discovery.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "bun:test";
import { discoverSkills } from "../discovery";
import { mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("discoverSkills", () => {
  const tempBase = join(tmpdir(), "bullhorse-test");

  it("should return empty array when .agents/skills doesn't exist", async () => {
    const result = await discoverSkills(tempBase);
    expect(result).toEqual([]);
  });

  it("should discover skills from .agents/skills directory", async () => {
    const skillsDir = join(tempBase, ".agents", "skills");
    const testSkillDir = join(skillsDir, "test-skill");
    const testSkillFile = join(testSkillDir, "SKILL.md");

    await mkdir(testSkillDir, { recursive: true });
    await writeFile(testSkillFile, `---
name: test-skill
description: A test skill
version: 1.0.0
---

# Test Skill`);

    const skills = await discoverSkills(tempBase);

    expect(skills.length).toBe(1);
    expect(skills[0]?.name).toBe("test-skill");

    await rm(tempBase, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/skills/__tests__/discovery.test.ts
```

- [ ] **Step 3: Implement discoverSkills**

```typescript
import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { createLogger } from "../../utils/logger";
import { parseYamlFrontmatter, stripFrontmatter } from "../../utils/yaml";
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

async function parseSkillFile(filePath: string, baseDir: string): Promise<Skill | null> {
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
    name: frontmatter.name,
    description: frontmatter.description,
    version: frontmatter.version,
    location: filePath,
    baseDir,
    frontmatter,
    body,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/skills/__tests__/discovery.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/skills/discovery.ts src/skills/__tests__/discovery.test.ts
git commit -m "feat(skills): add skill discovery and parsing"
```

---

## Task 4: Create Skill Registry

**Files:**
- Create: `src/skills/registry.ts`
- Create: `src/skills/__tests__/registry.test.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { SkillRegistry } from "../registry";
import type { Skill } from "../types";

describe("SkillRegistry", () => {
  let mockSkill: Skill;

  beforeEach(() => {
    mockSkill = {
      name: "test-skill",
      description: "Test skill",
      location: "/test/SKILL.md",
      baseDir: "/test",
      frontmatter: { name: "test-skill", description: "Test skill" },
    };
  });

  it("should store and retrieve skills", () => {
    const registry = new SkillRegistry();
    registry.setForThread("thread-1", [mockSkill]);

    const retrieved = registry.get("thread-1", "test-skill");
    expect(retrieved?.skill).toEqual(mockSkill);
  });

  it("should track activation status", () => {
    const registry = new SkillRegistry();
    registry.setForThread("thread-1", [mockSkill]);

    expect(registry.isActivated("thread-1", "test-skill")).toBe(false);

    registry.markActivated("thread-1", "test-skill");

    expect(registry.isActivated("thread-1", "test-skill")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/skills/__tests__/registry.test.ts
```

- [ ] **Step 3: Implement SkillRegistry**

```typescript
import type { Skill, SkillRegistryEntry } from "./types";

class SkillRegistry {
  private registries = new Map<string, Map<string, SkillRegistryEntry>>();

  setForThread(threadId: string, skills: Skill[]): void {
    const registry = new Map<string, SkillRegistryEntry>();
    for (const skill of skills) {
      registry.set(skill.name, { skill });
    }
    this.registries.set(threadId, registry);
  }

  get(threadId: string, skillName: string): SkillRegistryEntry | undefined {
    return this.getForThread(threadId).get(skillName);
  }

  getForThread(threadId: string): Map<string, SkillRegistryEntry> {
    return this.registries.get(threadId) || new Map();
  }

  markActivated(threadId: string, skillName: string): void {
    const entry = this.get(threadId, skillName);
    if (entry) {
      entry.activatedAt = new Date();
    }
  }

  isActivated(threadId: string, skillName: string): boolean {
    const entry = this.get(threadId, skillName);
    return entry?.activatedAt !== undefined;
  }

  clear(threadId: string): void {
    this.registries.delete(threadId);
  }
}

export const skillRegistry = new SkillRegistry();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/skills/__tests__/registry.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/skills/registry.ts src/skills/__tests__/registry.test.ts
git commit -m "feat(skills): add thread-scoped skill registry"
```

---

## Task 5: Create Skill Catalog Builder

**Files:**
- Create: `src/skills/catalog.ts`
- Create: `src/skills/__tests__/catalog.test.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from "bun:test";
import { buildSkillCatalog } from "../catalog";
import type { Skill } from "../types";

describe("buildSkillCatalog", () => {
  it("should build catalog from skills array", () => {
    const skills: Skill[] = [{
      name: "test-skill",
      description: "A test skill for catalog",
      location: "/test/SKILL.md",
      baseDir: "/test",
      frontmatter: { name: "test-skill", description: "A test skill for catalog" },
    }];

    const catalog = buildSkillCatalog(skills);

    expect(catalog).toContain("<available_skills>");
    expect(catalog).toContain("test-skill");
    expect(catalog).toContain("</available_skills>");
  });

  it("should return empty string for empty skills array", () => {
    const catalog = buildSkillCatalog([]);
    expect(catalog).toBe("");
  });

  it("should truncate long descriptions", () => {
    const longDesc = "A".repeat(300);
    const skills: Skill[] = [{
      name: "long-skill",
      description: longDesc,
      location: "/test/SKILL.md",
      baseDir: "/test",
      frontmatter: { name: "long-skill", description: longDesc },
    }];

    const catalog = buildSkillCatalog(skills);

    expect(catalog).toContain("…");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/skills/__tests__/catalog.test.ts
```

- [ ] **Step 3: Implement buildSkillCatalog**

```typescript
import type { Skill, SkillCatalogEntry } from "./types";

const MAX_DESC_CHARS = 250;

export function buildSkillCatalog(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const entries: SkillCatalogEntry[] = skills.map((skill) => ({
    name: skill.name,
    description: truncateDescription(skill.description, MAX_DESC_CHARS),
    location: skill.location,
  }));

  return `
<available_skills>
${entries.map((e) => `  <skill>
    <name>${e.name}</name>
    <description>${e.description}</description>
    <location>${e.location}</location>
  </skill>`).join("\n")}
</available_skills>

The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the activate_skill tool
with the skill's name to load its full instructions.
`;
}

function truncateDescription(desc: string, maxChars: number): string {
  if (desc.length <= maxChars) return desc;
  return desc.slice(0, maxChars - 1) + "…";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/skills/__tests__/catalog.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/skills/catalog.ts src/skills/__tests__/catalog.test.ts
git commit -m "feat(skills): add skill catalog builder"
```

---

## Task 6: Create Skills Barrel Export

**Files:**
- Create: `src/skills/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
export type { Skill, SkillFrontmatter, SkillRegistryEntry, SkillCatalogEntry } from "./types";
export { discoverSkills } from "./discovery";
export { buildSkillCatalog } from "./catalog";
export { skillRegistry } from "./registry";
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/index.ts
git commit -m "feat(skills): add barrel exports"
```

---

## Task 7: Create Activate Skill Tool

**Files:**
- Create: `src/tools/activate-skill.ts`

- [ ] **Step 1: Create tool**

```typescript
import { tool } from "deepagents";
import { z } from "zod";
import { createLogger } from "../utils/logger";
import { skillRegistry } from "../skills/registry";
import { stripFrontmatter } from "../utils/yaml";

const logger = createLogger("tools:activate-skill");

export const activateSkillTool = tool({
  name: "activate_skill",
  description: "Load and activate a skill from the repository's .agents/skills/ directory",

  schema: z.object({
    skill: z.string().describe("The skill name (e.g., 'test-driven-development')"),
    args: z.string().optional().describe("Optional arguments for the skill"),
  }),

  async execute({ skill, args }, context) {
    const configurable = context.configurable as Record<string, unknown> | undefined;
    const threadId = (configurable?.thread_id as string) || "default";
    const commandName = skill.startsWith("/") ? skill.substring(1) : skill;

    const registryEntry = skillRegistry.get(threadId, commandName);
    if (!registryEntry) {
      return `Skill '${commandName}' not found. Available: ${Array.from(skillRegistry.getForThread(threadId).keys()).join(", ")}`;
    }

    const skillData = registryEntry.skill;

    if (!skillData.body) {
      const rawContent = await Bun.file(skillData.location).text();
      skillData.body = stripFrontmatter(rawContent);
    }

    let content = skillData.body;
    if (args) {
      content = content.replace(/\$\{ARGUMENTS\}/g, args);
    }

    content = `Base directory for this skill: ${skillData.baseDir}\n\n${content}`;

    skillRegistry.markActivated(threadId, commandName);

    logger.info({ skill: commandName }, "[activate_skill] Skill activated");

    return `
<skill_content name="${skillData.name}">

${content}

</skill_content>
`;
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/activate-skill.ts
git commit -m "feat(tools): add activate_skill tool"
```

---

## Task 8: Register Activate Skill Tool

**Files:**
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Add to allTools array**

```typescript
import { activateSkillTool } from "./activate-skill";

export const allTools = [
  // ... existing tools ...
  activateSkillTool,
];
```

- [ ] **Step 2: Run typecheck**

```bash
bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat(tools): register activate_skill tool"
```

---

## Task 9: Create Skill Compaction Protection Middleware

**Files:**
- Create: `src/middleware/skill-compaction-protection.ts`

- [ ] **Step 1: Create middleware**

```typescript
import { createMiddleware } from "langchain";
import { createLogger } from "../utils/logger";

const logger = createLogger("middleware:skill-compaction");
const SKILL_CONTENT_TAG = "<skill_content";

export function createSkillCompactionProtectionMiddleware() {
  return createMiddleware({
    name: "skillCompactionProtection",

    wrapModelCall: async (request, handler) => {
      const messages = request.messages as Array<Record<string, unknown>>;

      const protectedMessages = messages.map((msg) => {
        const content = msg.content as string;

        if (typeof content === "string" && content.includes(SKILL_CONTENT_TAG)) {
          return { ...msg, _protected: true, _skillContent: true };
        }

        return msg;
      });

      return handler({ ...request, messages: protectedMessages });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware/skill-compaction-protection.ts
git commit -m "feat(middleware): add skill compaction protection"
```

---

## Task 10: Integrate Skills into Prompt Construction

**Files:**
- Modify: `src/prompt.ts`

- [ ] **Step 1: Add skill discovery to constructSystemPrompt**

```typescript
import { discoverSkills, buildSkillCatalog, skillRegistry } from "./skills";

export async function constructSystemPrompt(
  workingDir: string,
  linearProjectId: string = "",
  linearIssueNumber: string = "",
  agentsMd: string = "",
): Promise<string> {
  // ... existing code ...

  let skillsCatalog = "";
  try {
    const threadId = linearProjectId || "default";
    const skills = await discoverSkills(workingDir);

    if (skills.length > 0) {
      skillsCatalog = buildSkillCatalog(skills);
      skillRegistry.setForThread(threadId, skills);
    }
  } catch (err) {
    logger.warn({ err }, "[prompt] Failed to discover skills");
  }

  // ... in sections array, add skillsCatalog ...
  const sections = asSystemPrompt([
    // ... existing sections ...
    skillsCatalog,
    // ... rest ...
  ]);

  return sections.filter(Boolean).join("\n\n");
}
```

- [ ] **Step 2: Run typecheck**

```bash
bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/prompt.ts
git commit -m "feat(prompt): add skill discovery and catalog injection"
```

---

## Task 11: Add Compaction Middleware to DeepAgents

**Files:**
- Modify: `src/harness/deepagents.ts`

- [ ] **Step 1: Import and add middleware**

```typescript
import { createSkillCompactionProtectionMiddleware } from "../middleware/skill-compaction-protection";

const middleware: any[] = [
  // ... existing middleware ...
  createSkillCompactionProtectionMiddleware(),
  contextEditingMiddleware({ edits: [createProgressiveContextEdit()] }),
  // ... rest ...
];
```

- [ ] **Step 2: Run typecheck**

```bash
bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/harness/deepagents.ts
git commit -m "feat(harness): add skill compaction protection middleware"
```

---

## Task 12: Create Example Skill

**Files:**
- Create: `.agents/skills/test-driven-development/SKILL.md`

- [ ] **Step 1: Create example skill**

```bash
mkdir -p .agents/skills/test-driven-development
```

```markdown
---
name: test-driven-development
description: Enforce test-driven development workflow. Write tests first, then implement.
version: 1.0.0
---

# Test-Driven Development

When implementing features or fixing bugs, follow TDD:

1. **Write the failing test first**
2. **Run the test** - Verify it fails
3. **Implement minimal code** - Just enough to pass
4. **Run the test** - Verify it passes
5. **Refactor** - Keep tests green

## Commands

- Run tests: `bun test`
- Run specific test: `bun test <path-to-test-file>`
```

- [ ] **Step 2: Commit**

```bash
git add .agents/skills/test-driven-development/SKILL.md
git commit -m "docs(skills): add example TDD skill"
```

---

## Task 13: Manual Integration Testing

**Files:**
- None

- [ ] **Step 1: Start dev server**

```bash
bun run dev
```

- [ ] **Step 2: Test skill discovery**

Send a task working on current repo. Check logs for skills discovery.

- [ ] **Step 3: Test skill activation**

Ask agent to use TDD. Verify activate_skill is called.

---

## Task 14: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add skills section to CLAUDE.md**

```markdown
## Agent Skills

Bullhorse supports Agent Skills (agentskills.io). Skills in `.agents/skills/` are discovered automatically.

### Creating Skills

```yaml
---
name: my-skill
description: When to use this skill
---

# My Skill

Instructions...
```
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Agent Skills documentation"
```

---

## Task 15: Final Verification

**Files:**
- None

- [ ] **Step 1: Run tests**

```bash
bun test
```

- [ ] **Step 2: Run typecheck**

```bash
bunx tsc --noEmit
```

- [ ] **Step 3: Summary commit**

```bash
git add .
git commit -m "feat(skills): complete Agent Skills support"
```
