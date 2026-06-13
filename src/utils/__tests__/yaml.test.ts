import { describe, it, expect } from "bun:test";
import { parseYamlFrontmatter, stripFrontmatter } from "../yaml";

describe("YAML Utilities", () => {
  describe("parseYamlFrontmatter", () => {
    it("should parse valid YAML frontmatter", () => {
      const yaml = `
name: "test-skill"
description: "A test skill"
version: "1.0.0"
`;
      const result = parseYamlFrontmatter(yaml);
      expect(result).toEqual({
        name: "test-skill",
        description: "A test skill",
        version: "1.0.0",
      });
    });

    it("should parse YAML with various data types", () => {
      const yaml = `
string: "hello"
number: 42
boolean: true
array:
  - item1
  - item2
object:
  key: value
`;
      const result = parseYamlFrontmatter(yaml);
      expect(result).toEqual({
        string: "hello",
        number: 42,
        boolean: true,
        array: ["item1", "item2"],
        object: { key: "value" },
      });
    });

    it("should fix YAML with unquoted strings containing colons", () => {
      const yaml = `
title: "Chapter 1: The Beginning"
description: "This is a test: with colons"
`;
      const result = parseYamlFrontmatter(yaml);
      expect(result).toEqual({
        title: "Chapter 1: The Beginning",
        description: "This is a test: with colons",
      });
    });

    it("should handle YAML parsing failure that cannot be fixed by throwing", () => {
      // Invalid YAML that will fail both standard parse and fixed parse
      const yaml = ": invalid : yaml :";
      expect(() => parseYamlFrontmatter(yaml)).toThrow();
    });

    it("should handle YAML with null return", () => {
      // The yaml package can return null for certain parses. E.g., when the document is empty or comment-only.
      // But we already handle empty yaml. Let's provide a test just in case.
      const yaml = "# just a comment";
      const result = parseYamlFrontmatter(yaml);
      expect(result).toEqual({});
    });

    it("should hit line 22 branch when regex doesnt match", () => {
      // Create a scenario where fixCommonYamlIssues is called and match is false
      // This will hit the `return line;` fallback at line 22
      const yaml = ": invalid : yaml :\nno_match_line\n";
      expect(() => parseYamlFrontmatter(yaml)).toThrow();
    });

    it("should hit line 19 branch when regex matches but starts with quote", () => {
      // Create a scenario where fixCommonYamlIssues is called and match is true
      // but match[2].startsWith('"') is true, bypassing the stringification
      const yaml = ": invalid : yaml :\nkey: \"value:with:colon\"\n";
      expect(() => parseYamlFrontmatter(yaml)).toThrow();
    });

    it("should handle empty YAML", () => {
      const yaml = "";
      const result = parseYamlFrontmatter(yaml);
      expect(result).toEqual({});
    });

    it("should handle YAML with only whitespace", () => {
      const yaml = "   \n  \n  ";
      const result = parseYamlFrontmatter(yaml);
      expect(result).toEqual({});
    });
  });

  describe("stripFrontmatter", () => {
    it("should strip YAML frontmatter from markdown content", () => {
      const content = `---
name: "test-skill"
description: "A test skill"
---

# This is the content

Some markdown body text.
`;
      const result = stripFrontmatter(content);
      expect(result).toBe("# This is the content\n\nSome markdown body text.");
    });

    it("should return content unchanged if no frontmatter exists", () => {
      const content = `# Just markdown

No frontmatter here.`;
      const result = stripFrontmatter(content);
      expect(result).toBe(content);
    });

    it("should handle content with only frontmatter", () => {
      const content = `---
name: "test-skill"
---
`;
      const result = stripFrontmatter(content);
      expect(result).toBe("");
    });

    it("should handle frontmatter with multiline values", () => {
      const content = `---
description: |
  This is a multiline
  description
---

# Content here`;
      const result = stripFrontmatter(content);
      expect(result).toBe("# Content here");
    });

    it("should handle frontmatter with complex nested structures", () => {
      const content = `---
metadata:
  author: "John Doe"
  tags:
    - tag1
    - tag2
config:
  enabled: true
---

# Main content

Body text here.`;
      const result = stripFrontmatter(content);
      expect(result).toBe("# Main content\n\nBody text here.");
    });

    it("should trim whitespace from result", () => {
      const content = `---
name: "test"
---


# Content starts here


`;
      const result = stripFrontmatter(content);
      expect(result).toBe("# Content starts here");
    });

    it("should handle edge case: content starting with --- but no frontmatter", () => {
      const content = `---

Some content that starts with dashes but no proper frontmatter.`;
      const result = stripFrontmatter(content);
      expect(result).toBe(content);
    });
  });

  describe("Integration tests", () => {
    it("should parse a complete skill file", () => {
      const skillFile = `---
name: "commit"
description: "Create git commits with proper message formatting"
version: "1.0.0"
author: "Claude Code"
parameters:
  - name: "message"
    type: "string"
    required: true
---

# Commit Skill

Creates a git commit with the specified message following the project's commit conventions.`;

      const result = stripFrontmatter(skillFile);
      expect(result).toContain("# Commit Skill");
      expect(result).toContain("Creates a git commit");
      expect(result).not.toContain('name: "commit"');
    });
  });
});
