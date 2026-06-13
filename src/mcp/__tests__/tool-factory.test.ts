import { describe, it, expect } from "bun:test";
import { createMcpTool } from "../tool-factory.js";

describe("createMcpTool - Schema Translation", () => {
  it("translates basic types correctly", () => {
    const tool = createMcpTool({
      serverName: "test-server",
      name: "test-tool",
      description: "A test tool",
      inputSchema: {
        type: "object",
        properties: {
          str: { type: "string" },
          num: { type: "number" },
          int: { type: "integer" },
          bool: { type: "boolean" },
          arr: { type: "array", items: { type: "string" } },
          anyObj: { type: "object" },
          nullVal: { type: "null" }
        },
        required: ["str"]
      }
    });

    const schema = tool.schema as any;

    // Test valid input
    const valid = schema.parse({
      str: "hello",
      num: 1.5,
      int: 2,
      bool: true,
      arr: ["a", "b"],
      anyObj: { key: "value" },
      nullVal: null
    });

    expect(valid).toBeDefined();

    // Test missing required field
    expect(() => schema.parse({})).toThrow();

    // Test invalid type
    expect(() => schema.parse({ str: 123 })).toThrow();
  });

  it("handles empty schemas gracefully", () => {
    const tool = createMcpTool({
      serverName: "test-server",
      name: "test-tool",
      description: "A test tool for empty schemas",
      inputSchema: undefined
    });

    // Should parse empty object
    expect((tool.schema as any).parse({})).toEqual({});
  });

  it("handles complex object structures", () => {
    const tool = createMcpTool({
      serverName: "test-server",
      name: "test-tool",
      description: "A test tool for complex objects",
      inputSchema: {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "integer" }
            },
            required: ["name"]
          }
        },
        required: ["user"]
      }
    });

    const schema = tool.schema as any;

    expect(schema.parse({ user: { name: "Alice", age: 30 } })).toBeDefined();
    expect(() => schema.parse({ user: { age: 30 } })).toThrow();
    expect(() => schema.parse({})).toThrow();
  });

  it("handles anyOf (union) types", () => {
    const tool = createMcpTool({
      serverName: "test-server",
      name: "test-tool",
      description: "A test tool for anyOf",
      inputSchema: {
        type: "object",
        properties: {
          strOrNum: {
            anyOf: [
              { type: "string" },
              { type: "number" }
            ]
          }
        }
      }
    });

    const schema = tool.schema as any;

    // Both should be valid
    expect(schema.parse({ strOrNum: "hello" })).toBeDefined();
    expect(schema.parse({ strOrNum: 42 })).toBeDefined();

    // Invalid type
    expect(() => schema.parse({ strOrNum: true })).toThrow();
  });
});
