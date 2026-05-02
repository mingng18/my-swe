import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { loadRepoAgents, mergeSubagents, parseAgentsMd } from "../agentsLoader";
import { builtInSubagents } from "../registry";

const testAgentsDir = join(process.cwd(), ".agents", "agents");

describe("agentsLoader", () => {
  beforeEach(() => {
    // Ensure directory exists
    if (!existsSync(testAgentsDir)) {
      mkdirSync(testAgentsDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup test files
    const testFile = join(testAgentsDir, "test-agent.md");
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
  });

  it("should load agents from directory", async () => {
    const testContent = `---
name: test-agent
description: Test agent
tools: [code_search]
---

Test system prompt`;
    writeFileSync(join(testAgentsDir, "test-agent.md"), testContent);

    const agents = await loadRepoAgents(testAgentsDir);
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0].name).toBe("test-agent");
  });

  it("should handle missing directory gracefully", async () => {
    const agents = await loadRepoAgents("/nonexistent/path");
    expect(agents).toEqual([]);
  });

  it("should parse valid AGENTS.md file", () => {
    const content = `---
name: valid-agent
description: Valid agent
tools: [code_search, semantic_search]
---
System prompt here`;
    const result = parseAgentsMd(content, "valid.md");
    expect(result).not.toBeNull();
    expect(result?.name).toBe("valid-agent");
    expect(result?.systemPrompt).toBe("System prompt here");
  });

  it("should reject AGENTS.md without YAML frontmatter", () => {
    const content = "No frontmatter here";
    const result = parseAgentsMd(content, "invalid.md");
    expect(result).toBeNull();
  });

  it("should merge repo agents with built-ins", () => {
    const repoAgents = [
      {
        name: "repo-agent",
        description: "Repo agent",
        systemPrompt: "Test",
        tools: [],
      },
    ];
    const merged = mergeSubagents(builtInSubagents, repoAgents);
    expect(merged.length).toBe(builtInSubagents.length + 1);
  });

  it("repo agent should override built-in with same name", () => {
    const repoAgents = [
      {
        name: "explore-agent",
        description: "Custom explore",
        systemPrompt: "Custom prompt",
        tools: [],
      },
    ];
    const merged = mergeSubagents(builtInSubagents, repoAgents);
    const explore = merged.find(a => a.name === "explore-agent");
    expect(explore?.description).toBe("Custom explore");
  });

  it("should handle directory read errors (other than ENOENT)", async () => {
    // Create a file and try to read it as a directory, which throws ENOTDIR
    const testFilePath = join(testAgentsDir, "not-a-dir.txt");
    writeFileSync(testFilePath, "test");
    const agents = await loadRepoAgents(testFilePath);
    expect(agents).toEqual([]);
    unlinkSync(testFilePath);
  });

  it("should reject AGENTS.md with missing required fields", () => {
    const content = `---
name: incomplete-agent
---
System prompt`;
    const result = parseAgentsMd(content, "missing-fields.md");
    expect(result).toBeNull();
  });

  it("should reject AGENTS.md with empty system prompt", () => {
    const content = `---
name: valid-name
description: Valid description
---
  \n  `;
    const result = parseAgentsMd(content, "empty-prompt.md");
    expect(result).toBeNull();
  });

  it("should handle YAML parsing errors gracefully", () => {
    const content = `---
[invalid yaml
---
System prompt`;
    const result = parseAgentsMd(content, "invalid-yaml.md");
    expect(result).toBeNull();
  });
});
