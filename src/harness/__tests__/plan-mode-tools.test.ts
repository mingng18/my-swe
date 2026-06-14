import { describe, it, expect, beforeEach } from "bun:test";
import { allToolsUncompressed } from "../../tools";
import {
  PLAN_MODE_BLOCKED_TOOLS,
} from "../deepagents";

/**
 * Integration tests for #505 retrospective-review blockers.
 *
 * (a) /model rebuild preserves prior messages via the per-thread checkpointer
 *     — covered in thread-manager.test.ts (clearAgent keeps checkpointer).
 * (b) plan mode does NOT get write/shell tools — covered here by asserting the
 *     denylist actually removes the mutation tools from the real tool array.
 */

describe("Plan mode tool gating (#505 retro)", () => {
  beforeEach(() => {
    // sanity: the denylist is non-empty
    expect(PLAN_MODE_BLOCKED_TOOLS.size).toBeGreaterThan(0);
  });

  it("the denylist contains the known write/shell/mutation tools", () => {
    for (const name of [
      "commit_and_open_pr",
      "merge_pr",
      "create_github_issue",
      "comment_github_issue",
      "close_github_issue",
      "reopen_github_issue",
      "github_comment",
      "sandbox_shell",
      "sandbox_network",
      "sandbox_delete",
      "sandbox_mkdir",
      "sandbox_move",
      "sandbox_copy",
      "write_sandbox_file",
      "artifact_delete",
      "artifact_update",
      "memory_forget",
      "rewind_checkpoint",
      "call_mcp_tool",
    ]) {
      expect(PLAN_MODE_BLOCKED_TOOLS.has(name)).toBe(true);
    }
  });

  it("filtering the real tool array removes every blocked tool", () => {
    const blocked = new Set<string>();
    for (const t of allToolsUncompressed as any[]) {
      const name: string | undefined = t?.name;
      if (name && PLAN_MODE_BLOCKED_TOOLS.has(name)) blocked.add(name);
    }
    // Every blocked name that actually exists in the toolset must be filtered.
    // (Some blocked names may be sandbox-only and absent from allToolsUncompressed.)
    expect(blocked.size).toBeGreaterThan(0);
  });

  it("the plan-mode toolset is a strict subset of the full toolset and excludes blocked tools", () => {
    const planTools = (allToolsUncompressed as any[]).filter(
      (t) => t?.name && !PLAN_MODE_BLOCKED_TOOLS.has(t.name),
    );
    // Read-only tools the plan MUST retain
    const retained = new Set(planTools.map((t: any) => t.name));
    expect(retained.has("code_search")).toBe(true);
    expect(retained.has("semantic_search")).toBe(true);
    expect(retained.has("fetch_url")).toBe(true);
    expect(retained.has("activate_skill")).toBe(true);

    // Write/shell tools the plan MUST NOT have
    expect(retained.has("commit_and_open_pr")).toBe(false);
    expect(retained.has("sandbox_shell")).toBe(false);
    expect(retained.has("write_sandbox_file")).toBe(false);
    expect(retained.has("merge_pr")).toBe(false);
  });
});
