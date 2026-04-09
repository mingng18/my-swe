import { describe, it, expect, beforeEach } from "bun:test";
import { buildSkillCatalog } from "../catalog";
import type { Skill } from "../types";

describe("buildSkillCatalog", () => {
  let mockSkills: Skill[];

  beforeEach(() => {
    mockSkills = [
      {
        name: "skill-one",
        description: "First skill",
        location: "/test/one/SKILL.md",
        baseDir: "/test/one",
        frontmatter: {
          name: "skill-one",
          description: "First skill",
          version: "1.0.0",
        },
        body: "First skill content",
      },
      {
        name: "skill-two",
        description: "Second skill",
        location: "/test/two/SKILL.md",
        baseDir: "/test/two",
        frontmatter: {
          name: "skill-two",
          description: "Second skill",
          version: "2.0.0",
        },
        body: "Second skill content",
      },
    ];
  });

  it("should build XML catalog from skills array", () => {
    const catalog = buildSkillCatalog(mockSkills);

    expect(catalog).toContain("<available_skills>");
    expect(catalog).toContain("<name>skill-one</name>");
    expect(catalog).toContain("<name>skill-two</name>");
    expect(catalog).toContain("<description>First skill</description>");
    expect(catalog).toContain("<description>Second skill</description>");
    expect(catalog).toContain("<location>/test/one/SKILL.md</location>");
    expect(catalog).toContain("<location>/test/two/SKILL.md</location>");
    expect(catalog).toContain("</available_skills>");
    expect(catalog).toContain("activate_skill tool");
  });

  it("should return empty string for empty input", () => {
    const catalog = buildSkillCatalog([]);
    expect(catalog).toBe("");
  });

  it("should handle skills without body content", () => {
    const skillWithoutBody: Skill = {
      name: "skill-three",
      description: "Third skill",
      location: "/test/three/SKILL.md",
      baseDir: "/test/three",
      frontmatter: {
        name: "skill-three",
        description: "Third skill",
      },
    };

    const catalog = buildSkillCatalog([skillWithoutBody]);
    expect(catalog).toContain("<name>skill-three</name>");
    expect(catalog).toContain("<description>Third skill</description>");
  });

  it("should preserve skill order", () => {
    const catalog = buildSkillCatalog(mockSkills);
    const skillOneIndex = catalog.indexOf("<name>skill-one</name>");
    const skillTwoIndex = catalog.indexOf("<name>skill-two</name>");
    expect(skillOneIndex).toBeLessThan(skillTwoIndex);
  });

  it("should filter out skills with missing required fields", () => {
    const invalidSkill: Skill = {
      name: "",
      description: "",
      location: "/test/invalid/SKILL.md",
      baseDir: "/test/invalid",
      frontmatter: { name: "", description: "" },
    };

    const catalog = buildSkillCatalog([...mockSkills, invalidSkill]);
    expect(catalog).not.toContain("invalid");
  });

  it("should extract description from frontmatter first", () => {
    const skillWithFrontmatterDesc: Skill = {
      name: "skill-four",
      description: "Fallback description",
      location: "/test/four/SKILL.md",
      baseDir: "/test/four",
      frontmatter: {
        name: "skill-four",
        description: "Frontmatter description",
      },
    };

    const catalog = buildSkillCatalog([skillWithFrontmatterDesc]);
    expect(catalog).toContain(
      "<description>Frontmatter description</description>",
    );
  });

  it("should truncate descriptions to 250 characters", () => {
    const longDescSkill: Skill = {
      name: "long-skill",
      description: "a".repeat(300),
      location: "/test/long/SKILL.md",
      baseDir: "/test/long",
      frontmatter: {
        name: "long-skill",
        description: "a".repeat(300),
      },
    };

    const catalog = buildSkillCatalog([longDescSkill]);
    expect(catalog).toContain(
      "<description>" + "a".repeat(249) + "…</description>",
    );
  });
});
