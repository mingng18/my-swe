import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

const mockCall = mock();
const mockTavilySearchConstructor = mock();

const mockToolImplementation = {
  tool: (fn: any, config: any) => {
    const wrapped = async (args: any) => await fn(args);
    wrapped.invoke = async (args: any) => await fn(args);
    return wrapped;
  }
};

mock.module("langchain", () => mockToolImplementation);
mock.module("@langchain/core/tools", () => mockToolImplementation);

mock.module("@langchain/tavily", () => {
  return {
    TavilySearch: class {
      constructor(config: any) {
        mockTavilySearchConstructor(config);
      }
      _call = mockCall;
    }
  };
});

// Mock zod as per the memory hint for tests that error on 'zod' resolution
mock.module("zod", () => {
  const chainable = () => ({
    describe: chainable,
    optional: chainable,
    default: chainable,
  });
  return {
    z: {
      object: chainable,
      string: chainable,
      number: chainable,
      boolean: chainable,
      enum: chainable,
    }
  };
});

describe("search tool tests", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    mockCall.mockReset();
    mockTavilySearchConstructor.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("calls TavilySearch with correct default arguments", async () => {
    process.env.TAVILY_API_KEY = "test-api-key";

    // Dynamic import to allow mocks to apply first
    const mod = await import("./search");
    const toolToTest = mod.searchTool || mod.internetSearch;

    mockCall.mockResolvedValue("mocked search result");

    const result = await toolToTest.invoke({ query: "hello world" });

    expect(mockTavilySearchConstructor).toHaveBeenCalledWith({
      maxResults: 5,
      tavilyApiKey: "test-api-key",
      includeRawContent: false,
      topic: "general",
    });
    expect(mockCall).toHaveBeenCalledWith({ query: "hello world" });
    expect(result).toBe("mocked search result");
  });

  test("calls TavilySearch with provided arguments", async () => {
    process.env.TAVILY_API_KEY = "test-api-key-2";

    const mod = await import("./search");
    const toolToTest = mod.searchTool || mod.internetSearch;

    mockCall.mockResolvedValue("mocked search result 2");

    const result = await toolToTest.invoke({
      query: "custom query",
      maxResults: 10,
      topic: "news",
      includeRawContent: true,
    });

    expect(mockTavilySearchConstructor).toHaveBeenCalledWith({
      maxResults: 10,
      tavilyApiKey: "test-api-key-2",
      includeRawContent: true,
      topic: "news",
    });
    expect(mockCall).toHaveBeenCalledWith({ query: "custom query" });
    expect(result).toBe("mocked search result 2");
  });
});
