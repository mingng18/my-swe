import { describe, it, expect } from "bun:test";
import { discoverSkills } from "../discovery.ts";
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
    await writeFile(
      testSkillFile,
      `---
name: test-skill
description: A test skill
version: 1.0.0
---

# Test Skill`,
    );

    const skills = await discoverSkills(tempBase);

    expect(skills.length).toBe(1);
    expect(skills[0]?.name).toBe("test-skill");

    await rm(tempBase, { recursive: true, force: true });
  });
});
