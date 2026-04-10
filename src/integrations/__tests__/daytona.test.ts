import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";

mock.module("@daytonaio/sdk", () => ({
  Daytona: class DaytonaMock {}
}));

import { createDaytonaBackendFromEnv, isDaytonaBackend, DaytonaBackend } from "../daytona";

describe("daytona", () => {
  describe("createDaytonaBackendFromEnv", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      // Save original env
      originalEnv = { ...process.env };
      // Clear DAYTONA_ variables to start fresh
      for (const key in process.env) {
        if (key.startsWith("DAYTONA_")) {
          delete process.env[key];
        }
      }
    });

    afterEach(() => {
      // Restore original env
      process.env = originalEnv;
    });

    test("throws error when DAYTONA_API_KEY is missing", () => {
      expect(() => createDaytonaBackendFromEnv()).toThrow("DAYTONA_API_KEY is required. Set it in .env or environment.");
    });

    test("creates DaytonaBackend with default values when only DAYTONA_API_KEY is provided", () => {
      process.env.DAYTONA_API_KEY = "test-api-key";

      const backend = createDaytonaBackendFromEnv() as any;
      expect(backend).toBeInstanceOf(DaytonaBackend);
      expect(backend.config.apiKey).toBe("test-api-key");
      expect(backend.config.image).toBe("oven/bun:1");
      expect(backend.config.cpu).toBe(2);
      expect(backend.config.memory).toBe(4);
      expect(backend.config.disk).toBe(20);
      expect(backend.config.autoStopInterval).toBe(0);
      expect(backend.config.ephemeral).toBeUndefined();
    });

    test("parses numeric values correctly", () => {
      process.env.DAYTONA_API_KEY = "test-api-key";
      process.env.DAYTONA_CPU = "4";
      process.env.DAYTONA_MEMORY = "8";
      process.env.DAYTONA_DISK = "50";
      process.env.DAYTONA_AUTOSTOP = "60";
      process.env.DAYTONA_AUTOARCHIVE = "120";
      process.env.DAYTONA_AUTODELETE = "180";

      const backend = createDaytonaBackendFromEnv() as any;
      expect(backend.config.cpu).toBe(4);
      expect(backend.config.memory).toBe(8);
      expect(backend.config.disk).toBe(50);
      expect(backend.config.autoStopInterval).toBe(60);
      expect(backend.config.autoArchiveInterval).toBe(120);
      expect(backend.config.autoDeleteInterval).toBe(180);
    });

    test("parses boolean values correctly", () => {
      process.env.DAYTONA_API_KEY = "test-api-key";

      // Test true values
      process.env.DAYTONA_EPHEMERAL = "true";
      process.env.DAYTONA_NETWORK_BLOCK_ALL = "1";
      process.env.DAYTONA_PUBLIC = "yes";

      let backend = createDaytonaBackendFromEnv() as any;
      expect(backend.config.ephemeral).toBe(true);
      expect(backend.config.networkBlockAll).toBe(true);
      expect(backend.config.public).toBe(true);

      // Test false values
      process.env.DAYTONA_EPHEMERAL = "false";
      process.env.DAYTONA_NETWORK_BLOCK_ALL = "0";
      process.env.DAYTONA_PUBLIC = "no";

      backend = createDaytonaBackendFromEnv() as any;
      expect(backend.config.ephemeral).toBe(false);
      expect(backend.config.networkBlockAll).toBe(false);
      expect(backend.config.public).toBe(false);
    });

    test("parses JSON records correctly", () => {
      process.env.DAYTONA_API_KEY = "test-api-key";
      process.env.DAYTONA_LABELS_JSON = JSON.stringify({ env: "test", version: 1 });
      process.env.DAYTONA_ENV_VARS_JSON = JSON.stringify({ MY_VAR: "value", NUMBER: 42 });

      const backend = createDaytonaBackendFromEnv() as any;
      expect(backend.config.labels).toEqual({ env: "test", version: "1" });
      expect(backend.config.envVars).toEqual({ MY_VAR: "value", NUMBER: "42" });
    });

    test("handles invalid JSON records gracefully", () => {
      process.env.DAYTONA_API_KEY = "test-api-key";
      process.env.DAYTONA_LABELS_JSON = "{ invalid json }";

      const backend = createDaytonaBackendFromEnv() as any;
      expect(backend.config.labels).toBeUndefined();
    });

    test("parses language correctly", () => {
      process.env.DAYTONA_API_KEY = "test-api-key";
      process.env.DAYTONA_LANGUAGE = " TypeScript ";

      const backend = createDaytonaBackendFromEnv() as any;
      expect(backend.config.language).toBe("typescript");
    });

    test("handles unsupported language correctly", () => {
      process.env.DAYTONA_API_KEY = "test-api-key";
      process.env.DAYTONA_LANGUAGE = "ruby";

      const backend = createDaytonaBackendFromEnv() as any;
      expect(backend.config.language).toBeUndefined();
    });
  });

  describe("isDaytonaBackend", () => {
    test("returns true for a DaytonaBackend instance", () => {
      process.env.DAYTONA_API_KEY = "test-api-key";
      const backend = createDaytonaBackendFromEnv();
      expect(isDaytonaBackend(backend)).toBe(true);
    });

    test("returns false for non-Daytona objects", () => {
      expect(isDaytonaBackend(null)).toBe(false);
      expect(isDaytonaBackend(undefined)).toBe(false);
      expect(isDaytonaBackend("string")).toBe(false);
      expect(isDaytonaBackend({})).toBe(false);
      expect(isDaytonaBackend({ id: "123", execute: () => {} })).toBe(false);
    });
  });
});
