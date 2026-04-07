import { describe, it, expect, mock } from "bun:test";

mock.module("./utils/github/github-comments", () => ({
  UNTRUSTED_GITHUB_COMMENT_OPEN_TAG: "<!-- UNTRUSTED_COMMENT_START -->",
  UNTRUSTED_GITHUB_COMMENT_CLOSE_TAG: "<!-- UNTRUSTED_COMMENT_END -->",
}));

// We must dynamically import because prompt imports github-comments
const {
  asSystemPrompt,
  getWorkingEnvSection,
  constructSystemPrompt,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
} = await import("./prompt");

describe("prompt utilities", () => {
  describe("asSystemPrompt", () => {
    it("should return the input value cast as SystemPrompt", () => {
      const input = ["line 1", "line 2"];
      const result = asSystemPrompt(input);
      expect(result).toEqual(input as any);
    });
  });

  describe("getWorkingEnvSection", () => {
    it("should inject the working directory into the section string", () => {
      const workingDir = "/test/workspace";
      const result = getWorkingEnvSection(workingDir);
      expect(result).toContain(workingDir);
      expect(result).toContain(
        "You are operating in a **remote Linux sandbox** at \`/test/workspace\`.",
      );
    });
  });

  describe("constructSystemPrompt", () => {
    it("should construct the system prompt with default variables when only workingDir is provided", () => {
      const workingDir = "/test/workspace";
      const result = constructSystemPrompt(workingDir);

      expect(result).toContain(workingDir);
      expect(result).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
      expect(result).not.toContain("<agents_md>");
    });

    it("should include linearProjectId and linearIssueNumber but they are currently ignored in output", () => {
      const workingDir = "/test/workspace";
      const result = constructSystemPrompt(workingDir, "PRJ-123", "456");

      expect(result).toContain(workingDir);
      expect(result).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    });

    it("should include agentsMd when provided", () => {
      const workingDir = "/test/workspace";
      const agentsMd = "# Agent Rules\nDo something cool.";
      const result = constructSystemPrompt(workingDir, "", "", agentsMd);

      expect(result).toContain("<agents_md>");
      expect(result).toContain(agentsMd);
      expect(result).toContain("</agents_md>");
    });
  });
});
