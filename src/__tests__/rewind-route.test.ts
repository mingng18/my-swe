import { describe, it, expect, beforeAll, afterAll } from "bun:test";

/**
 * Lightweight HTTP-level test for the POST /rewind/:threadId/:checkpointId route.
 *
 * Avoids `mock.module` (which is process-global in bun:test and can pollute
 * other test files) by exercising the route against the real, empty
 * thread-manager: a thread id that was never initialized yields the documented
 * 404 response without needing a fake agent. The restore happy-path and the
 * unknown-checkpoint 404 are covered by the unit tests in
 * src/tools/__tests__/checkpoint-rewind.test.ts against a fake agent.
 */

const REWIND_PORT = parseInt(
  process.env.REWIND_TEST_PORT || "7871",
  10,
);
const REWIND_URL = `http://localhost:${REWIND_PORT}`;

describe("POST /rewind/:threadId/:checkpointId", () => {
  let server: any;

  beforeAll(async () => {
    // Ensure no auth interferes with the route under test.
    process.env.API_SECRET_KEY = "";
    const { default: app } = await import("../webapp");
    server = Bun.serve({ port: REWIND_PORT, fetch: app.fetch });
  });

  afterAll(() => {
    server?.stop();
  });

  it("returns 404 when no active agent exists for the thread", async () => {
    const res = await fetch(
      `${REWIND_URL}/rewind/no-such-thread/cp-1`,
      { method: "POST" },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("No active agent");
    expect(body.threadId).toBe("no-such-thread");
    expect(body.checkpointId).toBe("cp-1");
  });
});
