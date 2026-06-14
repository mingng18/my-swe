import { describe, it, expect, mock, beforeEach } from "bun:test";
import { McpClientManager } from "../client";

// Captures the options passed to `new Client(...)` so tests can assert the
// advertised capabilities (elicitation capability must only be advertised when
// a handler is registered).
let lastClientCapabilities: Record<string, any> | undefined;

// Per-instance handler capture: keyed by client identity (we only create one
// connected server per test, so a single slot is enough — reset per test).
let lastRegisteredHandler:
  | ((request: any) => Promise<any>)
  | null = null;
let lastRegisteredSchema: any = null;

mock.module("fs/promises", () => ({
  readFile: mock(async () =>
    JSON.stringify({
      servers: {
        test_server: { command: "echo", args: ["hi"] },
      },
    }),
  ),
}));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    constructor(_info: any, options: any) {
      lastClientCapabilities = options?.capabilities;
    }
    getServerCapabilities() {
      return { tools: true, resources: true };
    }
    async connect(_transport: any) {}
    async listTools() {
      return { tools: [{ name: "t" }] };
    }
    async listResources() {
      return { resources: [] };
    }
    async callTool() {
      return { ok: true };
    }
    async readResource() {
      return { contents: [] };
    }
    async close() {}
    setRequestHandler(schema: any, handler: (request: any) => Promise<any>) {
      lastRegisteredSchema = schema;
      lastRegisteredHandler = handler;
    }
  },
}));

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    options: any;
    constructor(options: any) {
      this.options = options;
    }
  },
}));

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    url: any;
    constructor(url: any) {
      this.url = url;
    }
  },
}));

describe("McpClientManager elicitation wiring", () => {
  beforeEach(() => {
    lastClientCapabilities = undefined;
    lastRegisteredHandler = null;
    lastRegisteredSchema = null;
  });

  it("advertises NO elicitation capability and registers NO handler by default (non-breaking)", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();

    // Backward-compat proof: today's behavior is preserved exactly.
    expect(lastClientCapabilities).toBeDefined();
    expect(lastClientCapabilities!.elicitation).toBeUndefined();
    expect(lastRegisteredHandler).toBeNull();

    // Standard tool execution still works.
    const result = await manager.executeTool("test_server", {
      name: "t",
      arguments: {},
    });
    expect(result.success).toBe(true);
  });

  it("advertises elicitation capability when a handler is registered before connect", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager.registerElicitationHandler({
      handler: async () => ({ action: "decline" }),
    });
    await manager.connectAll();

    expect(lastClientCapabilities!.elicitation).toEqual({});
    // Schema registered is the elicitation request schema.
    expect(lastRegisteredSchema).toBeDefined();
    // The registered handler is a function.
    expect(typeof lastRegisteredHandler).toBe("function");
  });

  it("installs the handler on an already-connected client when registered after connect", async () => {
    const manager = new McpClientManager("/test/workspace");
    await manager.connectAll();
    // No handler before registration.
    expect(lastRegisteredHandler).toBeNull();

    manager.registerElicitationHandler({
      handler: async () => ({ action: "decline" }),
    });
    expect(typeof lastRegisteredHandler).toBe("function");
  });

  it("forwards an elicitation/create request through to the transport handler", async () => {
    let surfaced: any;
    const manager = new McpClientManager("/test/workspace");
    manager.registerElicitationHandler({
      handler: async (req) => {
        surfaced = req;
        return { action: "accept", content: { branch: "feat" } };
      },
    });
    await manager.connectAll();

    // Simulate the server sending an elicitation/create request.
    const result = await lastRegisteredHandler!({
      method: "elicitation/create",
      params: {
        mode: "form",
        message: "Which branch?",
        requestedSchema: {
          type: "object",
          properties: { branch: { type: "string" } },
          required: ["branch"],
        },
      },
    });

    expect(result.action).toBe("accept");
    expect(result.content).toEqual({ branch: "feat" });
    // The surfaced request is the normalized, transport-friendly shape.
    expect(surfaced.serverName).toBe("test_server");
    expect(surfaced.params.message).toBe("Which branch?");
  });

  it("declines gracefully when the transport handler throws", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager.registerElicitationHandler({
      handler: async () => {
        throw new Error("boom");
      },
    });
    await manager.connectAll();

    const result = await lastRegisteredHandler!({
      method: "elicitation/create",
      params: { message: "q", requestedSchema: { type: "object", properties: {} } },
    });
    expect(result.action).toBe("decline");
  });

  it("rejects registerElicitationHandler when no handler function is provided", () => {
    const manager = new McpClientManager("/test/workspace");
    expect(() =>
      manager.registerElicitationHandler({ handler: "not-a-fn" as any }),
    ).toThrow(/handler/);
  });

  it("keeps the capability at {} (form-mode) by default when registered", async () => {
    // Spec: empty elicitation capability => form-mode support (backwards compat).
    const manager = new McpClientManager("/test/workspace");
    manager.registerElicitationHandler({
      handler: async () => ({ action: "decline" }),
    });
    await manager.connectAll();
    expect(lastClientCapabilities!.elicitation).toEqual({});
  });

  it("clears disposers on disconnect without throwing", async () => {
    const manager = new McpClientManager("/test/workspace");
    manager.registerElicitationHandler({
      handler: async () => ({ action: "decline" }),
    });
    await manager.connectAll();
    // Should not throw and should leave the manager in a clean state.
    await expect(manager.disconnectAll()).resolves.toBeUndefined();
    expect(manager.getConnectedClients().length).toBe(0);
  });
});
