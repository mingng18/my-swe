import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  trimStr,
  formatStreamNs,
  shouldTraceAgentToTerminal,
  parseLangGraphStreamChunk,
  messageChunkText,
  summarizeUpdateForTrace,
  stringifyPayloadForTrace,
} from "../stream-trace";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("trimStr", () => {
  it("returns the string unchanged when shorter than max", () => {
    expect(trimStr("hello", 10)).toBe("hello");
  });

  it("returns the string unchanged when equal to max", () => {
    expect(trimStr("hello", 5)).toBe("hello");
  });

  it("truncates with ellipsis when longer than max", () => {
    const result = trimStr("hello world", 5);
    expect(result).toBe("hello…");
    expect(result.length).toBe(6); // 5 chars + ellipsis
  });

  it("handles empty string", () => {
    expect(trimStr("", 10)).toBe("");
  });
});

describe("formatStreamNs", () => {
  it('returns "main" for null', () => {
    expect(formatStreamNs(null)).toBe("main");
  });

  it('returns "main" for undefined', () => {
    expect(formatStreamNs(undefined)).toBe("main");
  });

  it('returns "main" for empty array', () => {
    expect(formatStreamNs([])).toBe("main");
  });

  it("joins array elements with > ", () => {
    expect(formatStreamNs(["a", "b", "c"])).toBe("a > b > c");
  });

  it("converts non-array to string", () => {
    expect(formatStreamNs("single")).toBe("single");
    expect(formatStreamNs(42)).toBe("42");
  });
});

describe("shouldTraceAgentToTerminal", () => {
  const originalEnv = process.env.AGENT_TRACE_STDERR;

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.AGENT_TRACE_STDERR;
    } else {
      process.env.AGENT_TRACE_STDERR = originalEnv;
    }
  });

  it("returns true when AGENT_TRACE_STDERR=true", () => {
    process.env.AGENT_TRACE_STDERR = "true";
    expect(shouldTraceAgentToTerminal()).toBe(true);
  });

  it("returns true when AGENT_TRACE_STDERR=1", () => {
    process.env.AGENT_TRACE_STDERR = "1";
    expect(shouldTraceAgentToTerminal()).toBe(true);
  });

  it("returns false when AGENT_TRACE_STDERR=false", () => {
    process.env.AGENT_TRACE_STDERR = "false";
    expect(shouldTraceAgentToTerminal()).toBe(false);
  });

  it("returns false when AGENT_TRACE_STDERR=0", () => {
    process.env.AGENT_TRACE_STDERR = "0";
    expect(shouldTraceAgentToTerminal()).toBe(false);
  });

  it("falls back to process.stderr.isTTY when env is not set", () => {
    delete process.env.AGENT_TRACE_STDERR;
    // In test environment, stderr is typically not a TTY
    const expected = Boolean(process.stderr.isTTY);
    expect(shouldTraceAgentToTerminal()).toBe(expected);
  });
});

describe("parseLangGraphStreamChunk", () => {
  it("returns null for non-array input", () => {
    expect(parseLangGraphStreamChunk("not an array")).toBeNull();
    expect(parseLangGraphStreamChunk(42)).toBeNull();
    expect(parseLangGraphStreamChunk(null)).toBeNull();
  });

  it("returns null for arrays with less than 2 elements", () => {
    expect(parseLangGraphStreamChunk([])).toBeNull();
    expect(parseLangGraphStreamChunk(["only_one"])).toBeNull();
  });

  it("parses 3-element chunks into ns, mode, payload", () => {
    const result = parseLangGraphStreamChunk([
      ["namespace"],
      "updates",
      { key: "value" },
    ]);
    expect(result).toEqual({
      ns: ["namespace"],
      mode: "updates",
      payload: { key: "value" },
    });
  });

  it("parses 2-element chunks into null ns, mode, payload", () => {
    const result = parseLangGraphStreamChunk(["messages", { data: true }]);
    expect(result).toEqual({
      ns: null,
      mode: "messages",
      payload: { data: true },
    });
  });
});

describe("messageChunkText", () => {
  it("returns string content directly", () => {
    expect(messageChunkText({ content: "hello" })).toBe("hello");
  });

  it("extracts text from content parts", () => {
    const msg = {
      content: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
    };
    expect(messageChunkText(msg)).toBe("hello world");
  });

  it("ignores non-text content parts", () => {
    const msg = {
      content: [
        { type: "image", url: "http://example.com" },
        { type: "text", text: "only this" },
      ],
    };
    expect(messageChunkText(msg)).toBe("only this");
  });

  it("returns empty string for unknown content type", () => {
    expect(messageChunkText({ content: 42 as unknown })).toBe("");
    expect(messageChunkText({ content: null as unknown })).toBe("");
  });
});

describe("summarizeUpdateForTrace", () => {
  it("returns empty string for null data", () => {
    expect(summarizeUpdateForTrace("node", null)).toBe("");
  });

  it("returns empty string for data without messages", () => {
    expect(summarizeUpdateForTrace("node", { other: "field" })).toBe("");
  });

  it("summarizes tool calls from the last message", () => {
    const data = {
      messages: [
        {
          tool_calls: [
            { name: "read_file" },
            { name: "write_file" },
          ],
        },
      ],
    };
    const result = summarizeUpdateForTrace("agent", data);
    expect(result).toBe(" → read_file, write_file");
  });

  it("detects tool messages by type", () => {
    const data = {
      messages: [{ type: "tool", name: "read_file" }],
    };
    const result = summarizeUpdateForTrace("agent", data);
    expect(result).toBe(" → tool:read_file");
  });

  it("detects tool messages by role", () => {
    const data = {
      messages: [{ role: "tool", name: "exec" }],
    };
    const result = summarizeUpdateForTrace("agent", data);
    expect(result).toBe(" → tool:exec");
  });
});

describe("stringifyPayloadForTrace", () => {
  it("JSON-stringifies data", () => {
    expect(stringifyPayloadForTrace({ a: 1 }, 100)).toBe('{"a":1}');
  });

  it("truncates long output", () => {
    const longData = { text: "a".repeat(500) };
    const result = stringifyPayloadForTrace(longData, 20);
    expect(result.length).toBeLessThanOrEqual(21); // 20 + ellipsis
    expect(result.endsWith("…")).toBe(true);
  });
});
