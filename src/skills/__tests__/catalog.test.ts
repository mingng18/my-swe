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

  it("should build catalog from skills array", () => {
    const catalog = buildSkillCatalog(mockSkills);

    expect(catalog).toHaveLength(2);
    expect(catalog[0]).toEqual({
      name: "skill-one",
      description: "First skill",
      location: "/test/one/SKILL.md",
    });
    expect(catalog[1]).toEqual({
      name: "skill-two",
      description: "Second skill",
      location: "/test/two/SKILL.md",
    });
  });

  it("should return empty array for empty input", () => {
    const catalog = buildSkillCatalog([]);
    expect(catalog).toEqual([]);
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
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toEqual({
      name: "skill-three",
      description: "Third skill",
      location: "/test/three/SKILL.md",
    });
  });

  it("should preserve skill order", () => {
    const catalog = buildSkillCatalog(mockSkills);
    expect(catalog[0].name).toBe("skill-one");
    expect(catalog[1].name).toBe("skill-two");
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
    expect(catalog).toHaveLength(2);
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
    expect(catalog[0].description).toBe("Frontmatter description");
  });
});
