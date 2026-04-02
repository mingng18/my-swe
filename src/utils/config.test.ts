import { test, expect, mock, describe, beforeEach, afterEach } from "bun:test";

let mockExists = false;
let mockRead = "";

mock.module("node:fs", () => ({
  existsSync: mock((path) => {
    if (path === "langgraph.json") return mockExists;
    const fs = import.meta.require("node:fs");
    return fs.existsSync(path);
  }),
  readFileSync: mock((path, options) => {
    if (path === "langgraph.json") return mockRead;
    const fs = import.meta.require("node:fs");
    return fs.readFileSync(path, options);
  }),
}));

import { validateStartupConfig } from "./config";

describe("validateStartupConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENAI_API_KEY = "test-key";
    process.env.MODEL = "test-model";
  });

  afterEach(() => {
    process.env = originalEnv;
    mockExists = false;
    mockRead = "";
  });

  test("passes when langgraph.json does not exist", () => {
    mockExists = false;
    expect(() => validateStartupConfig()).not.toThrow();
  });

  test("passes when langgraph.json exists with valid export", () => {
    mockExists = true;
    mockRead = JSON.stringify({ graphs: { agent: "src/server.ts:getGraphForExport" } });
    expect(() => validateStartupConfig()).not.toThrow();
  });

  test("throws when langgraph.json exists with invalid export", () => {
    mockExists = true;
    mockRead = JSON.stringify({ graphs: { agent: "src/server.ts:someOtherExport" } });
    expect(() => validateStartupConfig()).toThrow(/Invalid langgraph graph export/);
  });
});
