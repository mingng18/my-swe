import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import { McpClientManager, getMcpManager, cleanupMcpManager } from "../client";

// Global mock state
let mockListToolsError = false;
let mockListResourcesError = false;
let mockConnectError = false;
let mockCloseError = false;
let mockFsError = false;
let mockToolExecutionTimeout = false;
let mockResourceReadTimeout = false;

// Mock dependencies
mock.module("fs/promises", () => ({
  readFile: mock(async (path: string) => {
    if (mockFsError) {
      throw new Error("Simulated fs error");
    }
    if (path.includes("ENOENT")) {
      const err = new Error("ENOENT");
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    }
    return JSON.stringify({
      servers: {
        test_server: {
          command: "echo",
          args: ["hello"],
        },
        disabled_server: {
          command: "echo",
          disabled: true,
        },
        failing_server: {
          command: "fail",
        },
        sse_server: {
          type: "sse",
          url: "http://localhost:8080/sse"
        },
        http_server: {
          type: "http",
          url: "http://localhost:8080/http"
        }
      }
    });
  }),
}));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: class MockClient {
      constructor(clientInfo: any, options: any) {}
      getServerCapabilities() { return { tools: true, resources: true }; }
      async connect(transport: any) {
        if (transport.options && transport.options.command === "fail") {
          throw new Error("Connection failed");
        }
        if (mockConnectError) {
          throw new Error("Simulated connection error");
        }
        return Promise.resolve();
      }
      async listTools() {
        if (mockListToolsError) {
          throw new Error("Simulated listTools error");
        }
        return { tools: [{ name: "test_tool" }] };
      }
      async listResources() {
        if (mockListResourcesError) {
          throw new Error("Simulated listResources error");
        }
        return { resources: [{ uri: "test://uri", name: "test_resource" }] };
      }
      async callTool(options: any) {
        if (mockToolExecutionTimeout) {
          return new Promise(resolve => setTimeout(() => resolve({ result: "late" }), 100));
        }
        return { result: "success" };
      }
      async readResource(options: any) {
        if (mockResourceReadTimeout) {
           return new Promise(resolve => setTimeout(() => resolve({ contents: "late" }), 100));
        }
        return { contents: "resource_data" };
      }
      async close() {
        if (mockCloseError) {
          throw new Error("Simulated close error");
        }
        return Promise.resolve();
      }
    }
  };
});

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => {
  return {
    StdioClientTransport: class MockStdioTransport {
      options: any;
      constructor(options: any) {
        this.options = options;
      }
    }
  };
});

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => {
  return {
    SSEClientTransport: class MockSSETransport {
      url: any;
      constructor(url: any) {
        this.url = url;
      }
    }
  };
});


describe("McpClientManager", () => {
  beforeEach(() => {
    // Reset global state
    mockListToolsError = false;
    mockListResourcesError = false;
    mockConnectError = false;
    mockCloseError = false;
    mockFsError = false;
    mockToolExecutionTimeout = false;
    mockResourceReadTimeout = false;

    // Clear the registry to ensure test isolation for getMcpManager tests
    cleanupMcpManager("/test/workspace").catch(() => {});
  });

  it("should load configuration", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.loadConfig();
    expect(manager["config"]).toBeDefined();
    expect(manager["config"]?.servers?.test_server).toBeDefined();
  });

  it("should skip loading if ENOENT", async () => {
    const manager = new McpClientManager("ENOENT");
    await manager.loadConfig();
    expect(manager["config"]).toEqual({ servers: {} });
  });

  it("should handle general fs error during loadConfig", async () => {
    const manager = new McpClientManager("/test/workspace");
    mockFsError = true;
    await manager.loadConfig();
    expect(manager["config"]).toEqual({ servers: {} });
  });

  it("should handle failing connection to a specific server", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    // Test the state of the failing server
    const failingClient = manager.getClient("failing_server");
    expect(failingClient).toBeDefined();
    expect(failingClient?.state).toBe("error");
    expect(failingClient?.error).toContain("Connection failed");
  });

  it("should connect to SSE and HTTP servers", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    expect(manager.getClient("sse_server")?.state).toBe("connected");
    expect(manager.getClient("http_server")?.state).toBe("connected");
  });

  it("should list all tools across servers", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    const tools = await manager.getAllTools();
    // 3 connected servers: test_server, sse_server, http_server
    expect(tools.length).toBe(3);
    expect(tools[0].name).toBe("test_tool");
  });

  it("should handle errors during listTools", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    mockListToolsError = true;
    const tools = await manager.getAllTools();
    expect(tools.length).toBe(0);
  });

  it("should handle malformed response without tools array from listTools", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager["clients"].set("test_server", {
      name: "test_server",
      state: "connected",
      client: {
        listTools: async () => ({}) // Missing .tools array
      }
    });

    const tools = await manager.getAllTools();
    expect(tools.length).toBe(0);
  });

  it("should list all resources across servers", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    const resources = await manager.getAllResources();
    expect(resources.length).toBe(3);
  });

  it("should handle errors during listResources", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    mockListResourcesError = true;
    const resources = await manager.getAllResources();
    expect(resources.length).toBe(0);
  });

  it("should handle malformed response without resources array from listResources", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager["clients"].set("test_server", {
      name: "test_server",
      state: "connected",
      client: {
        listResources: async () => ({}) // Missing .resources array
      }
    });

    const resources = await manager.getAllResources();
    expect(resources.length).toBe(0);
  });

  it("should execute a tool on a specific server", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    const result = await manager.executeTool("test_server", { name: "test_tool", arguments: {} });
    expect(result.success).toBe(true);
    expect(result.content).toEqual({ result: "success" });
  });

  it("should return error if server not found for tool execution", async () => {
    const manager = new McpClientManager("/test/workspace");
    const result = await manager.executeTool("non_existent", { name: "test_tool", arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("should return error if server not connected for tool execution", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.loadConfig(); // load without connecting
    manager["clients"].set("test_server", { name: "test_server", state: "disconnected" });
    const result = await manager.executeTool("test_server", { name: "test_tool", arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error).toContain("is not connected");
  });

  it("should return error if server lacks tool capabilities", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager["clients"].set("test_server", {
      name: "test_server",
      state: "connected",
      capabilities: {} // no tools
    });
    const result = await manager.executeTool("test_server", { name: "test_tool", arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error).toContain("does not support tools");
  });

  it("should return error if tool execution throws an error", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager["clients"].set("test_server", {
      name: "test_server",
      state: "connected",
      capabilities: { tools: true },
      client: {
        callTool: async () => { throw new Error("Simulated tool error"); }
      }
    });
    const result = await manager.executeTool("test_server", { name: "test_tool", arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Simulated tool error");
  });

  it("should handle tool execution timeout", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    mockToolExecutionTimeout = true;

    const result = await manager.executeTool("test_server", {
      name: "test_tool",
      arguments: {},
      timeoutMs: 10 // Short timeout to force failure
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Tool execution timeout");
  });

  it("should read a resource from a specific server", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    const result = await manager.readResource("test_server", "test://uri");
    expect(result.success).toBe(true);
    expect(result.content).toEqual({ contents: "resource_data" });
  });

  it("should return error if server not found for resource read", async () => {
    const manager = new McpClientManager("/test/workspace");
    const result = await manager.readResource("non_existent", "test://uri");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("should return error if server not connected for resource read", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager["clients"].set("test_server", { name: "test_server", state: "disconnected" });
    const result = await manager.readResource("test_server", "test://uri");
    expect(result.success).toBe(false);
    expect(result.error).toContain("is not connected");
  });

  it("should return error if server lacks resource capabilities", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager["clients"].set("test_server", {
      name: "test_server",
      state: "connected",
      capabilities: {} // no resources
    });
    const result = await manager.readResource("test_server", "test://uri");
    expect(result.success).toBe(false);
    expect(result.error).toContain("does not support resources");
  });

  it("should return error if resource read throws an error", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager["clients"].set("test_server", {
      name: "test_server",
      state: "connected",
      capabilities: { resources: true },
      client: {
        readResource: async () => { throw new Error("Simulated resource error"); }
      }
    });
    const result = await manager.readResource("test_server", "test://uri");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Simulated resource error");
  });

  it("should handle resource read timeout using mock timer", async () => {
    const manager = new McpClientManager("/test/workspace");

    manager["clients"].set("test_server", {
      name: "test_server",
      state: "connected",
      capabilities: { resources: true },
      client: {
        readResource: async () => new Promise(resolve => setTimeout(resolve, 100))
      }
    });

    const originalSetTimeout = global.setTimeout;
    let timeoutCb: any;
    // @ts-ignore
    global.setTimeout = (cb, ms) => {
      timeoutCb = cb;
      // invoke immediately to trigger timeout
      cb();
      return 1 as any;
    };

    try {
      const result = await manager.readResource("test_server", "test://uri");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Resource read timeout");
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  it("should disconnect all clients and clean up registry", async () => {
    const manager = getMcpManager("/test/workspace");
    await manager.connectAll();

    expect(manager.getConnectedClients().length).toBe(3); // test_server, sse_server, http_server

    await cleanupMcpManager("/test/workspace");

    expect(manager.getConnectedClients().length).toBe(0);
    // getting again should create a new instance
    const newManager = getMcpManager("/test/workspace");
    expect(newManager).not.toBe(manager);
  });

  it("should handle error during disconnect gracefully", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    mockCloseError = true;
    // Should not throw
    await manager.disconnectAll();

    expect(manager.getConnectedClients().length).toBe(0);
  });

  it("should support fallback from getClient config when connectAll is called again", async () => {
     const manager = new McpClientManager("/test/workspace");
     await manager.connectAll();
     expect(manager.getConnectedClients().length).toBe(3);

     // Called again, should not reload config as it exists
     await manager.connectAll();
     // Should still be 3 as map keys overwrite
     expect(manager.getConnectedClients().length).toBe(3);
  });
});
