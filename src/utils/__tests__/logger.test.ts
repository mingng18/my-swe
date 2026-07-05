import { describe, it, expect } from "bun:test";
import { logger, createLogger } from "../logger";

describe("logger utility", () => {
  describe("createLogger", () => {
    it("should return a child logger with the provided name", () => {
      const name = "my-test-module";

      const childLogger = createLogger(name);

      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe("function");

      // In pino, child loggers have bindings that include the properties passed in
      if (typeof childLogger.bindings === 'function') {
        const bindings = childLogger.bindings();
        expect(bindings).toHaveProperty('name', name);
      }
    });

    it("should return a functional child logger", () => {
      const childLogger = createLogger("another-module");
      expect(childLogger).toHaveProperty("info");
      expect(childLogger).toHaveProperty("error");
      expect(childLogger).toHaveProperty("warn");
      expect(childLogger).toHaveProperty("debug");
    });
  });

  describe("default logger", () => {
    it("should be defined and expose logging methods", () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.error).toBe("function");
    });
  });
});
