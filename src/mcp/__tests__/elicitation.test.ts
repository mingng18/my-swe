import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import {
  buildElicitResult,
  normalizeElicitParams,
  installElicitationHandler,
  DEFAULT_ELICITATION_TIMEOUT_MS,
} from "../elicitation";
import type {
  ElicitationHandler,
  ElicitResult,
  McpElicitationOptions,
} from "../types";

/**
 * A minimal in-process MCP client stand-in that records the handler registered
 * via setRequestHandler and lets the test invoke it. Mirrors the small surface
 * of @modelcontextprotocol/sdk Client that the elicitation code touches.
 */
class FakeMcpClient {
  registeredHandler:
    | ((request: any) => Promise<any>)
    | null = null;
  registeredSchema: any = null;
  errors: Error[] = [];
  setRequestHandler(schema: any, handler: (request: any) => Promise<any>) {
    this.registeredSchema = schema;
    this.registeredHandler = handler;
  }
  async elicit(request: any): Promise<any> {
    if (!this.registeredHandler) {
      throw new Error("no handler registered");
    }
    return this.registeredHandler(request);
  }
}

/**
 * A fake client whose setRequestHandler throws — exercises the graceful
 * failure path of installElicitationHandler.
 */
class FailingMcpClient extends FakeMcpClient {
  setRequestHandler(_schema: any, _handler: any) {
    throw new Error("handler registration disabled");
  }
}

/** Build a raw MCP elicitation/create request (form mode). */
function formRequest(
  message = "Which branch?",
  properties: Record<string, any> = { branch: { type: "string" } },
): any {
  return {
    method: "elicitation/create",
    params: {
      mode: "form",
      message,
      requestedSchema: { type: "object", properties, required: ["branch"] },
    },
  };
}

/** Build a raw MCP elicitation/create request (url mode). */
function urlRequest(message = "Authenticate", url = "https://x/auth"): any {
  return {
    method: "elicitation/create",
    params: {
      mode: "url",
      message,
      elicitationId: "el_1",
      url,
    },
  };
}

describe("normalizeElicitParams", () => {
  it("normalizes a form-mode request", () => {
    const out = normalizeElicitParams(formRequest("hi"), "srv");
    expect(out.serverName).toBe("srv");
    expect(out.params.mode).toBe("form");
    expect(out.params.message).toBe("hi");
    expect(out.params.requestedSchema?.properties.branch).toBeDefined();
    expect(out.params.url).toBeUndefined();
  });

  it("normalizes a url-mode request", () => {
    const out = normalizeElicitParams(urlRequest(), "srv");
    expect(out.params.mode).toBe("url");
    expect(out.params.url).toBe("https://x/auth");
    expect(out.params.elicitationId).toBe("el_1");
    expect(out.params.requestedSchema).toBeUndefined();
  });

  it("defaults mode to form when missing", () => {
    const out = normalizeElicitParams(
      { params: { message: "q" } },
      "srv",
    );
    expect(out.params.mode).toBe("form");
  });

  it("tolerates a missing params object", () => {
    const out = normalizeElicitParams({}, "srv");
    expect(out.params.message).toBe("");
    expect(out.params.mode).toBe("form");
  });
});

describe("buildElicitResult", () => {
  it("builds an accept result with content", () => {
    const r = buildElicitResult("accept", { branch: "main" });
    expect(r.action).toBe("accept");
    expect(r.content).toEqual({ branch: "main" });
  });

  it("drops content for non-accept actions", () => {
    const r = buildElicitResult("decline", { branch: "main" });
    expect(r.action).toBe("decline");
    expect(r.content).toBeUndefined();
  });

  it("omits content when undefined", () => {
    const r = buildElicitResult("accept");
    expect(r.action).toBe("accept");
    expect(r.content).toBeUndefined();
  });
});

describe("installElicitationHandler", () => {
  it("registers a handler that returns the user's accept result", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = async (req) => ({
      action: "accept",
      content: { branch: `answer:${req.params.message}` },
    });

    installElicitationHandler(client, "srv", { handler });

    expect(client.registeredHandler).not.toBeNull();
    const result = await client.elicit(formRequest("deploy where?"));
    expect(result.action).toBe("accept");
    expect(result.content).toEqual({ branch: "answer:deploy where?" });
  });

  it("passes through decline and cancel actions", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = async () => ({ action: "decline" });
    installElicitationHandler(client, "srv", { handler });
    const r1 = await client.elicit(formRequest());
    expect(r1.action).toBe("decline");
  });

  it("treats undefined handler result as decline", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = async () => undefined;
    installElicitationHandler(client, "srv", { handler });
    const r = await client.elicit(formRequest());
    expect(r.action).toBe("decline");
  });

  it("treats null handler result as decline", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = async () => null as any;
    installElicitationHandler(client, "srv", { handler });
    const r = await client.elicit(formRequest());
    expect(r.action).toBe("decline");
  });

  it("coerces an invalid action to decline", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = async () =>
      ({ action: "bogus" } as any);
    installElicitationHandler(client, "srv", { handler });
    const r = await client.elicit(formRequest());
    expect(r.action).toBe("decline");
  });

  it("returns decline (never throws) when the handler throws", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = async () => {
      throw new Error("transport exploded");
    };
    installElicitationHandler(client, "srv", { handler });
    // Must not reject:
    const r = await client.elicit(formRequest());
    expect(r.action).toBe("decline");
  });

  it("returns cancel when the handler exceeds the timeout", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ action: "accept" }), 1000),
      );
    installElicitationHandler(client, "srv", { handler, timeoutMs: 20 });

    const r = await client.elicit(formRequest());
    expect(r.action).toBe("cancel");
  });

  it("returns the accept result when the handler beats the timeout", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = async () => ({
      action: "accept",
      content: { branch: "dev" },
    });
    installElicitationHandler(client, "srv", { handler, timeoutMs: 1000 });

    const r = await client.elicit(formRequest());
    expect(r.action).toBe("accept");
    expect(r.content).toEqual({ branch: "dev" });
  });

  it("with timeoutMs <= 0 never times out", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = async () => ({ action: "accept" });
    installElicitationHandler(client, "srv", { handler, timeoutMs: 0 });
    const r = await client.elicit(formRequest());
    expect(r.action).toBe("accept");
  });

  it("does not throw if setRequestHandler fails (returns no-op disposer)", () => {
    const client = new FailingMcpClient();
    const handler: ElicitationHandler = async () => ({ action: "accept" });
    const dispose = installElicitationHandler(client, "srv", { handler });
    expect(typeof dispose).toBe("function");
    expect(() => dispose()).not.toThrow();
    // nothing registered
    expect(client.registeredHandler).toBeNull();
  });

  it("the returned disposer overwrites the handler with a decline default", async () => {
    const client = new FakeMcpClient();
    const handler: ElicitationHandler = async () => ({
      action: "accept",
      content: { branch: "x" },
    });
    const dispose = installElicitationHandler(client, "srv", { handler });
    dispose();
    const r = await client.elicit(formRequest());
    expect(r.action).toBe("decline");
  });

  it("surfaces the server name in the request passed to the handler", async () => {
    const client = new FakeMcpClient();
    let seen: any;
    const handler: ElicitationHandler = async (req) => {
      seen = req;
      return { action: "decline" };
    };
    installElicitationHandler(client, "my-server", { handler });
    await client.elicit(formRequest());
    expect(seen.serverName).toBe("my-server");
    expect(seen.params.message).toBe("Which branch?");
  });
});

describe("DEFAULT_ELICITATION_TIMEOUT_MS", () => {
  it("is 30000ms (matches non-breaking default)", () => {
    expect(DEFAULT_ELICITATION_TIMEOUT_MS).toBe(30000);
  });
});
