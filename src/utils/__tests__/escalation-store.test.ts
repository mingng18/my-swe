import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { storeEscalation, getEscalations } from "./escalation-store";
import { rm, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

describe("Escalation Store", () => {
  let originalEnv: string | undefined;
  let testStorePath: string;

  beforeEach(async () => {
    testStorePath = `.cursor/state/test-escalations-${randomUUID()}.json`;
    await mkdir(dirname(testStorePath), { recursive: true });
    originalEnv = process.env.ESCALATION_STORE_PATH;
    process.env.ESCALATION_STORE_PATH = testStorePath;
  });

  afterEach(async () => {
    try {
      await rm(testStorePath, { force: true });
    } catch (e) {
      // ignore
    }
    if (originalEnv !== undefined) {
      process.env.ESCALATION_STORE_PATH = originalEnv;
    } else {
      delete process.env.ESCALATION_STORE_PATH;
    }
  });

  test("can store and retrieve an escalation", async () => {
    const attempts = [
      {
        attemptNumber: 0,
        success: false,
        error: "Failed",
        durationMs: 100,
        timestamp: new Date(),
      },
    ];

    const id = await storeEscalation("test-node", attempts, "Last error");
    expect(id).toBeDefined();

    const records = await getEscalations();
    expect(records.length).toBe(1);
    expect(records[0]?.id).toBe(id);
    expect(records[0]?.nodeId).toBe("test-node");
    expect(records[0]?.lastError).toBe("Last error");
    expect(records[0]?.attempts.length).toBe(1);
    expect(records[0]?.attempts[0]?.error).toBe("Failed");
  });

  test("handles multiple escalations", async () => {
    await storeEscalation("node-1", [], "Error 1");
    await storeEscalation("node-2", [], "Error 2");

    const records = await getEscalations();
    expect(records.length).toBe(2);
    expect(records[0]?.nodeId).toBe("node-1");
    expect(records[1]?.nodeId).toBe("node-2");
  });
});
