import { describe, it, expect, mock } from "bun:test";
import { SnapshotManager } from "../snapshot-manager";
import { SnapshotStore } from "../snapshot-store";

describe("SnapshotManager - OpenSandbox Integration", () => {
  it("documents known bug in implementation: OpenSandbox snapshot/checkpoint API is not yet available", async () => {
    const mockStore = {
      get: mock(() =>
        Promise.resolve({
          provider: "opensandbox",
          snapshotId: "some-id",
          refreshedAt: new Date(),
        }),
      ),
      save: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve()),
      listAll: mock(() => Promise.resolve([])),
      recordAccess: mock(() => Promise.resolve()),
    } as unknown as SnapshotStore;

    const manager = new SnapshotManager(mockStore);

    const result = await manager.restoreSnapshot({
      repoOwner: "test",
      repoName: "test",
      profile: "typescript",
      branch: "main",
    });

    expect(result.success).toBe(true);
    expect(result.sandbox).toBeNull();
    expect(result.fromCache).toBe(false);
    expect(result.error).toContain(
      "Provider opensandbox snapshot APIs not yet integrated",
    );
  });
});
