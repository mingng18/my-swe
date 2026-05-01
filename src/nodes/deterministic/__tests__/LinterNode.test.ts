import {
  test,
  expect,
  describe,
  mock,
  afterEach,
  beforeEach,
  spyOn,
} from "bun:test";
import { initializeMemoryServices, isMemoryEnabled } from "../LinterNode";

describe("LinterNode - initializeMemoryServices", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Clone env before each test
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore env after each test
    process.env = { ...originalEnv };
  });

  test("initializes memory services when MEMORY_ENABLED=true", () => {
    process.env.MEMORY_ENABLED = "true";

    // MemoryRepository requires these to be set or it throws an error and falls back to false
    process.env.SUPABASE_URL = "http://localhost:8000";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-key";
    process.env.OPENAI_API_KEY = "dummy-openai-key";

    initializeMemoryServices();
    expect(isMemoryEnabled()).toBe(true);
  });

  test("does not initialize when MEMORY_ENABLED=false", () => {
    process.env.MEMORY_ENABLED = "false";
    initializeMemoryServices();
    expect(isMemoryEnabled()).toBe(false);
  });

  test("handles initialization errors gracefully", () => {
    process.env.MEMORY_ENABLED = "true";

    // Intentionally omit SUPABASE_URL to force MemoryRepository to throw an error
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-key";

    // Should not throw an unhandled exception
    expect(() => initializeMemoryServices()).not.toThrow();

    // But should result in disabled memory
    expect(isMemoryEnabled()).toBe(false);
  });
});
