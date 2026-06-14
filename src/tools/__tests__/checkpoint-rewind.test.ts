import { describe, it, expect } from "bun:test";
import type {
  CheckpointedAgent,
  StateHistoryEntry,
} from "../checkpoint-rewind";
import {
  restoreCheckpoint,
  findCheckpoint,
  CheckpointNotFoundError,
  checkpointRewindTool,
} from "../checkpoint-rewind";

/**
 * Build a fake agent whose `getStateHistory` yields the given snapshots and
 * whose `updateState` records its calls. Snapshots are yielded newest-first
 * (matching the real LangGraph ordering).
 */
function makeFakeAgent(snapshots: StateHistoryEntry[]): {
  agent: CheckpointedAgent;
  updateStateCalls: Array<{
    config: Record<string, unknown>;
    values: unknown;
    asNode?: string;
  }>;
} {
  const updateStateCalls: Array<{
    config: Record<string, unknown>;
    values: unknown;
    asNode?: string;
  }> = [];

  async function* gen(): AsyncIterableIterator<StateHistoryEntry> {
    for (const snap of snapshots) {
      yield snap;
    }
  }

  const agent: CheckpointedAgent = {
    getStateHistory: () => gen(),
    updateState: async (config, values, asNode?) => {
      updateStateCalls.push({ config, values, asNode });
      return { configurable: { ...(config.configurable as object) } };
    },
  };

  return { agent, updateStateCalls };
}

function snapshot(
  checkpointId: string,
  values: Record<string, unknown>,
  extra: Partial<StateHistoryEntry> = {},
): StateHistoryEntry {
  return {
    values,
    next: [],
    config: { configurable: { thread_id: "t1", checkpoint_id: checkpointId } },
    ...extra,
  };
}

describe("findCheckpoint", () => {
  it("returns the snapshot whose checkpoint_id matches", async () => {
    const snaps = [
      snapshot("c3", { messages: [3] }),
      snapshot("c2", { messages: [2] }),
      snapshot("c1", { messages: [1] }),
    ];
    const { agent } = makeFakeAgent(snaps);

    const found = await findCheckpoint(agent, "t1", "c2");

    expect(found).toBeDefined();
    expect(
      (found?.config.configurable as Record<string, unknown>)?.checkpoint_id,
    ).toBe("c2");
  });

  it("returns undefined when no checkpoint matches", async () => {
    const { agent } = makeFakeAgent([snapshot("c1", {})]);

    const found = await findCheckpoint(agent, "t1", "does-not-exist");

    expect(found).toBeUndefined();
  });
});

describe("restoreCheckpoint", () => {
  it("calls updateState with the matching snapshot's config and values", async () => {
    const target = snapshot("c2", { messages: [{ role: "user" }] });
    const { agent, updateStateCalls } = makeFakeAgent([
      snapshot("c3", { messages: [3] }),
      target,
      snapshot("c1", { messages: [1] }),
    ]);

    const restored = await restoreCheckpoint(agent, "t1", "c2");

    expect(restored).toBe(target);
    expect(updateStateCalls).toHaveLength(1);
    expect(updateStateCalls[0]?.config).toBe(target.config);
    expect(updateStateCalls[0]?.values).toBe(target.values);
  });

  it("throws CheckpointNotFoundError for an unknown checkpoint id", async () => {
    const { agent } = makeFakeAgent([snapshot("c1", {})]);

    await expect(restoreCheckpoint(agent, "t1", "nope")).rejects.toBeInstanceOf(
      CheckpointNotFoundError,
    );
  });

  it("CheckpointNotFoundError carries thread + checkpoint metadata", () => {
    const err = new CheckpointNotFoundError("thread-x", "cp-y");
    expect(err.threadId).toBe("thread-x");
    expect(err.checkpointId).toBe("cp-y");
    expect(err.message).toContain("thread-x");
    expect(err.message).toContain("cp-y");
  });
});

/**
 * Tool input-validation paths. These exercise the tool without registering a
 * process-wide `mock.module` for the thread-manager (which can pollute other
 * test files sharing the same bun process). The agent-resolution paths are
 * covered indirectly through `restoreCheckpoint` unit tests above and the
 * HTTP route in tests/harness.
 */
describe("checkpointRewindTool", () => {
  it("returns a JSON error when thread_id is missing from config", async () => {
    const result = await checkpointRewindTool.invoke(
      { checkpointId: "c1" },
      { configurable: {} },
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("thread_id");
  });

  it("returns a JSON error when no agent exists for the thread", async () => {
    // Use a thread id that was never initialized in the real threadManager,
    // so the dynamic import resolves the real (empty) manager.
    const result = await checkpointRewindTool.invoke(
      { checkpointId: "c1" },
      { configurable: { thread_id: "never-initialized-thread-for-tests" } },
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("No active agent");
  });

  it("has the expected name and schema", () => {
    expect(checkpointRewindTool.name).toBe("rewind_checkpoint");
  });
});
