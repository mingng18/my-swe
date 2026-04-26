import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

const mockCall = mock();
const mockTavilySearchConstructor = mock();



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
    const mod = await import("../search");
    const toolToTest = mod.searchTool;

    mockCall.mockResolvedValue("mocked search result");

    const result = await toolToTest.invoke({ query: "hello world" });

    expect(mockTavilySearchConstructor).toHaveBeenCalledWith({
      maxResults: 5,
      tavilyApiKey: "test-api-key",
      includeRawContent: false,
      topic: "general",
    });
    expect(mockCall).toHaveBeenCalledWith({ query: "hello world" });
    expect(result as any).toBe("mocked search result");
  });

  test("calls TavilySearch with provided arguments", async () => {
    process.env.TAVILY_API_KEY = "test-api-key-2";

    const mod = await import("../search");
    const toolToTest = mod.searchTool;

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
    expect(result as any).toBe("mocked search result 2");
  });
});
