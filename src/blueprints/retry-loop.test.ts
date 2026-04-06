import { describe, expect, test } from "bun:test";
import {
  createBoundedRetryLoop,
  BoundedRetryLoop,
  defaultEscalationHandler,
} from "./retry-loop";

describe("createBoundedRetryLoop", () => {
  test("creates a BoundedRetryLoop with default options", () => {
    const loop = createBoundedRetryLoop();
    expect(loop).toBeInstanceOf(BoundedRetryLoop);
    // Access private property to verify the default handler is set
    expect((loop as any).escalationHandler).toBe(defaultEscalationHandler);
  });

  test("creates a BoundedRetryLoop with a custom escalation handler", async () => {
    const customHandler = async () => {};
    const loop = createBoundedRetryLoop({ escalationHandler: customHandler });
    expect(loop).toBeInstanceOf(BoundedRetryLoop);
    // Access private property to verify the custom handler is set
    expect((loop as any).escalationHandler).toBe(customHandler);
  });
});
