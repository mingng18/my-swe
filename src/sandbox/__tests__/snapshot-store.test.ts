import { describe, it, expect, spyOn } from "bun:test";
import { globalSnapshotStore, initializeSnapshotStore, FilesystemSnapshotStore } from "../snapshot-store";

describe("Snapshot Store Initialization", () => {
  it("exports a global instance of FilesystemSnapshotStore", () => {
    expect(globalSnapshotStore).toBeInstanceOf(FilesystemSnapshotStore);
  });

  it("calls initialize on the global store when initializeSnapshotStore is called", async () => {
    const initSpy = spyOn(globalSnapshotStore, "initialize").mockImplementation(async () => {});

    await initializeSnapshotStore();

    expect(initSpy).toHaveBeenCalled();

    initSpy.mockRestore();
  });
});
