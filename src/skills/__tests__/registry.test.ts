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

  it("should return all skills for a thread", () => {
    const registry = new SkillRegistry();
    const mockSkill2: Skill = {
      name: "test-skill-2",
      description: "Test skill 2",
      location: "/test/SKILL2.md",
      baseDir: "/test",
      frontmatter: { name: "test-skill-2", description: "Test skill 2" },
    };

    registry.setForThread("thread-1", [mockSkill, mockSkill2]);

    const skills = registry.getAllForThread("thread-1");
    expect(skills).toHaveLength(2);
    expect(skills[0].skill.name).toBe("test-skill");
    expect(skills[1].skill.name).toBe("test-skill-2");
  });

  it("should return empty array for non-existent thread", () => {
    const registry = new SkillRegistry();
    const skills = registry.getAllForThread("non-existent");
    expect(skills).toEqual([]);
  });

  it("should clear skills for a thread", () => {
    const registry = new SkillRegistry();
    registry.setForThread("thread-1", [mockSkill]);

    registry.clearThread("thread-1");

    const skills = registry.getAllForThread("thread-1");
    expect(skills).toEqual([]);
  });

  it("should return null for non-existent skill", () => {
    const registry = new SkillRegistry();
    registry.setForThread("thread-1", [mockSkill]);

    const retrieved = registry.get("thread-1", "non-existent");
    expect(retrieved).toBeNull();
  });

  it("should track activation timestamp", () => {
    const registry = new SkillRegistry();
    registry.setForThread("thread-1", [mockSkill]);

    const before = new Date();
    registry.markActivated("thread-1", "test-skill");
    const after = new Date();

    const entry = registry.get("thread-1", "test-skill");
    expect(entry?.activatedAt).toBeDefined();
    expect(entry?.activatedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(entry?.activatedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
