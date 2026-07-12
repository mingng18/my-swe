import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { parseReposJson } from "../src/prewarm";

describe("parseReposJson", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PREWARM_REPOS_JSON;
    delete process.env.PREWARM_REPO;
    delete process.env.PREWARM_COUNT;
    delete process.env.SANDBOX_PROFILE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return empty array when no env vars are set", () => {
    expect(parseReposJson()).toEqual([]);
  });

  it("should parse PREWARM_REPOS_JSON when provided", () => {
    const repos = [
      { owner: "owner1", name: "repo1", count: 2 },
      { owner: "owner2", name: "repo2" }
    ];
    process.env.PREWARM_REPOS_JSON = JSON.stringify(repos);

    expect(parseReposJson()).toEqual(repos);
  });

  it("should parse PREWARM_REPO when provided without count and profile", () => {
    process.env.PREWARM_REPO = "facebook/react";

    expect(parseReposJson()).toEqual([
      { owner: "facebook", name: "react", count: 1, profile: undefined }
    ]);
  });

  it("should parse PREWARM_REPO with PREWARM_COUNT", () => {
    process.env.PREWARM_REPO = "facebook/react";
    process.env.PREWARM_COUNT = "5";

    expect(parseReposJson()).toEqual([
      { owner: "facebook", name: "react", count: 5, profile: undefined }
    ]);
  });

  it("should fallback to count 1 if PREWARM_COUNT is invalid", () => {
    process.env.PREWARM_REPO = "facebook/react";
    process.env.PREWARM_COUNT = "invalid";

    expect(parseReposJson()).toEqual([
      { owner: "facebook", name: "react", count: 1, profile: undefined }
    ]);
  });

  it("should parse PREWARM_REPO with SANDBOX_PROFILE", () => {
    process.env.PREWARM_REPO = "facebook/react";
    process.env.SANDBOX_PROFILE = "large";

    expect(parseReposJson()).toEqual([
      { owner: "facebook", name: "react", count: 1, profile: "large" as any }
    ]);
  });

  it("should throw if PREWARM_REPO is invalid", () => {
    process.env.PREWARM_REPO = "invalid-repo";

    expect(() => parseReposJson()).toThrow(
      "Invalid PREWARM_REPO. Expected 'owner/name' (e.g. facebook/react)."
    );
  });
});
