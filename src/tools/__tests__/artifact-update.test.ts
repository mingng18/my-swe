import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spyOn } from "bun:test";
import * as memoryPointer from "../../utils/memory-pointer";
import { artifactUpdateTool } from "../artifact-query";

describe("artifactUpdateTool", () => {
  let mockRetrieveArtifact: any;
  let mockUpdateArtifact: any;

  const validConfig = {
    configurable: { thread_id: "test-thread" },
  };

  const existingArtifact = {
    metadata: {
      id: "ptr_abc123",
      threadId: "test-thread",
      type: "code",
      size: 100,
      tokenCount: 25,
      timestamp: Date.now() - 1000,
      expiresAt: Date.now() + 86400000,
      metadata: {},
    },
    content: "original content",
  };

  const updatedArtifact = {
    metadata: {
      id: "ptr_abc123",
      threadId: "test-thread",
      type: "code",
      size: 200,
      tokenCount: 50,
      timestamp: Date.now(),
      expiresAt: Date.now() + 86400000,
      metadata: {},
    },
    content: "updated content",
  };

  beforeEach(() => {
    mockRetrieveArtifact = spyOn(memoryPointer, "retrieveArtifact")
      .mockResolvedValue(existingArtifact as any);
    mockUpdateArtifact = spyOn(memoryPointer, "updateArtifact")
      .mockResolvedValue(updatedArtifact as any);
  });

  afterEach(() => {
    if (mockRetrieveArtifact) mockRetrieveArtifact.mockRestore();
    if (mockUpdateArtifact) mockUpdateArtifact.mockRestore();
  });

  it("should return error if thread_id is missing", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "new" },
      { configurable: {} } as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toBe("Missing thread_id");
  });

  it("should return error for invalid pointer_id format", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "invalid", content: "new" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toContain("Invalid pointer_id format");
  });

  it("should return error if no update fields provided", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toContain("At least one update field");
  });

  it("should return error if artifact not found", async () => {
    mockRetrieveArtifact.mockResolvedValue(null);
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "new" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toContain("Artifact not found or access denied");
  });

  it("should update with replace mode (default)", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "new content" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(mockUpdateArtifact).toHaveBeenCalledWith(
      "ptr_abc123",
      "test-thread",
      expect.objectContaining({
        content: "new content",
        mode: "replace",
      }),
    );
  });

  it("should update with append mode", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "appended", mode: "append" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(mockUpdateArtifact).toHaveBeenCalledWith(
      "ptr_abc123",
      "test-thread",
      expect.objectContaining({
        content: "appended",
        mode: "append",
      }),
    );
  });

  it("should update with prepend mode", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "prepended", mode: "prepend" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(mockUpdateArtifact).toHaveBeenCalledWith(
      "ptr_abc123",
      "test-thread",
      expect.objectContaining({
        content: "prepended",
        mode: "prepend",
      }),
    );
  });

  it("should reject content exceeding max size", async () => {
    // MAX_POINTER_SIZE_TOKENS is 5000, so ~20000 chars exceeds it
    const hugeContent = "x".repeat(25000);
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: hugeContent },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.error).toBe("Content exceeds maximum size");
    expect(result.estimated_tokens).toBeDefined();
    expect(result.max_tokens).toBeDefined();
    expect(mockUpdateArtifact).not.toHaveBeenCalled();
  });

  it("should update metadata only", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", metadata: { tag: "important" } },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(mockUpdateArtifact).toHaveBeenCalledWith(
      "ptr_abc123",
      "test-thread",
      expect.objectContaining({
        metadata: { tag: "important" },
      }),
    );
  });

  it("should handle updateArtifact returning null", async () => {
    mockUpdateArtifact.mockResolvedValue(null);
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "new" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toContain("Failed to update artifact");
  });
});
