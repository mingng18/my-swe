/**
 * Tests for tool filtering utilities.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  filterToolsByName,
  exploreTools,
  planTools,
  generalPurposeTools,
} from "../toolFilter";

describe("toolFilter", () => {
  describe("filterToolsByName", () => {
    it("should return all tools when no filters are provided", () => {
      const tools = filterToolsByName();
      expect(tools.length).toBeGreaterThan(0);
      expect(Array.isArray(tools)).toBe(true);
    });

    it("should filter to allowed tools only", () => {
      const tools = filterToolsByName(["code_search", "semantic_search"]);
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain("code_search");
      expect(toolNames).toContain("semantic_search");
      expect(toolNames).not.toContain("commit_and_open_pr");
      expect(toolNames).not.toContain("merge_pr");
    });

    it("should exclude disallowed tools", () => {
      const tools = filterToolsByName(undefined, [
        "commit_and_open_pr",
        "merge_pr",
      ]);
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).not.toContain("commit_and_open_pr");
      expect(toolNames).not.toContain("merge_pr");
      // Should still contain other tools
      expect(toolNames.length).toBeGreaterThan(0);
    });

    it("should prioritize disallowed over allowed when both are provided", () => {
      const tools = filterToolsByName(
        ["code_search", "commit_and_open_pr", "merge_pr"],
        ["commit_and_open_pr", "merge_pr"],
      );
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain("code_search");
      expect(toolNames).not.toContain("commit_and_open_pr");
      expect(toolNames).not.toContain("merge_pr");
    });
  });

  describe("exploreTools", () => {
    it("should include read-only tools", () => {
      const toolNames = exploreTools.map((t) => t.name);

      expect(toolNames).toContain("code_search");
      expect(toolNames).toContain("semantic_search");
      expect(toolNames).toContain("internet_search");
      expect(toolNames).toContain("fetch_url");
    });

    it("should not include commit and merge tools", () => {
      const toolNames = exploreTools.map((t) => t.name);

      expect(toolNames).not.toContain("commit_and_open_pr");
      expect(toolNames).not.toContain("merge_pr");
    });

    it("should not include sandbox shell tool", () => {
      const toolNames = exploreTools.map((t) => t.name);

      expect(toolNames).not.toContain("sandbox_shell");
    });

    it("should not include artifact tools", () => {
      const toolNames = exploreTools.map((t) => t.name);

      expect(toolNames).not.toContain("artifact_query");
      expect(toolNames).not.toContain("artifact_list");
      expect(toolNames).not.toContain("artifact_delete");
    });
  });

  describe("planTools", () => {
    it("should be the same as exploreTools", () => {
      expect(planTools).toEqual(exploreTools);
    });
  });

  describe("generalPurposeTools", () => {
    it("should return all tools", () => {
      const allToolsFiltered = filterToolsByName();
      expect(generalPurposeTools).toEqual(allToolsFiltered);
    });
  });
});
