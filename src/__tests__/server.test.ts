import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockRun = mock();
const mockGetAgentHarness = mock().mockReturnValue({
  run: mockRun,
});

mock.module("./harness", () => ({
  getAgentHarness: mockGetAgentHarness,
}));

mock.module("./utils/logger", () => ({
  createLogger: () => ({
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
  }),
}));

import { runCodeagentTurn } from "../server";

describe("runCodeagentTurn", () => {
  beforeEach(() => {
    mockRun.mockClear();
    mockGetAgentHarness.mockClear();
  });

  it("should return the reply on successful execution with default threadId", async () => {
    mockRun.mockResolvedValue({ reply: "Hello world!" });

    const result = await runCodeagentTurn("Hi");

    expect(mockGetAgentHarness).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith("Hi", { threadId: "default-session" });
    expect(result).toBe("Hello world!");
  });

  it("should pass provided threadId to harness", async () => {
    mockRun.mockResolvedValue({ reply: "Hello specific thread!" });

    const result = await runCodeagentTurn("Hi there", "custom-thread-id");

    expect(mockRun).toHaveBeenCalledWith("Hi there", {
      threadId: "custom-thread-id",
    });
    expect(result).toBe("Hello specific thread!");
  });

  it("should return the error from harness if reply is absent", async () => {
    mockRun.mockResolvedValue({ error: "Agent error occurred" });

    const result = await runCodeagentTurn("Test error");

    expect(result).toBe("Agent error occurred");
  });

  it("should fall back to (empty reply) when no reply or error is returned", async () => {
    mockRun.mockResolvedValue({});

    const result = await runCodeagentTurn("Test empty");

    expect(result).toBe("(empty reply)");
  });

  it("should truncate replies longer than 8190 characters", async () => {
    const longReply = "a".repeat(9000);
    mockRun.mockResolvedValue({ reply: longReply });

    const result = await runCodeagentTurn("Test truncation");

    expect(result.length).toBe(8191); // 8190 + 1 for "…"
    expect(result.endsWith("…")).toBe(true);
    expect(result.startsWith("a".repeat(8190))).toBe(true);
  });

  it("should catch and return formatted Error exceptions", async () => {
    mockRun.mockRejectedValue(new Error("Network failure"));

    const result = await runCodeagentTurn("Test exception");

    expect(result).toBe("Error: Network failure");
  });

  it("should catch and return formatted string exceptions", async () => {
    mockRun.mockRejectedValue("String exception");

    const result = await runCodeagentTurn("Test string exception");

    expect(result).toBe("Error: String exception");
  });
});
