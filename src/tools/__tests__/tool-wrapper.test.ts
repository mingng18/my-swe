import { describe, expect, test, mock } from "bun:test";

// We need to mock the logger to prevent console spam and to verify it's called
const mockLoggerError = mock();
mock.module("../../utils/logger", () => ({
  createLogger: () => ({
    error: mockLoggerError,
    info: mock(),
    warn: mock(),
    debug: mock()
  })
}));

// Import dynamically after mocking
const { withErrorHandling } = await import("../tool-wrapper");

describe("withErrorHandling", () => {
  test("should return the result of the function if it succeeds", async () => {
    const fn = mock(async (args: { foo: string }) => {
      return args.foo + " bar";
    });
    const wrappedFn = withErrorHandling("test-tool", fn);
    const result = await wrappedFn({ foo: "hello" }, {});
    expect(result).toBe("hello bar");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ foo: "hello" }, {});
  });

  test("should return a JSON error string and log if the function throws an Error", async () => {
    mockLoggerError.mockClear();
    const errorMsg = "Something went wrong";
    const fn = mock(async () => {
      throw new Error(errorMsg);
    });

    const args = { data: "test" };
    const wrappedFn = withErrorHandling("test-tool", fn);
    const result = await wrappedFn(args, {});

    expect(typeof result).toBe("string");

    const parsedResult = JSON.parse(result as string);
    expect(parsedResult.error).toBe("Tool 'test-tool' encountered an unexpected internal error.");
    expect(parsedResult.message).toBe(errorMsg);
  });

  test("should handle non-Error thrown values", async () => {
    mockLoggerError.mockClear();
    const fn = mock(async () => {
      throw "Just a string error";
    });

    const wrappedFn = withErrorHandling("test-tool", fn);
    const result = await wrappedFn({}, {});

    expect(typeof result).toBe("string");

    const parsedResult = JSON.parse(result as string);
    expect(parsedResult.error).toBe("Tool 'test-tool' encountered an unexpected internal error.");
    expect(parsedResult.message).toBe("Just a string error");
  });
});
