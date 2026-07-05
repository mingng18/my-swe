import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { extractRepoFromInput } from "../sandbox-resolver";

describe("extractRepoFromInput", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GITHUB_DEFAULT_OWNER;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GITHUB_DEFAULT_OWNER;
    } else {
      process.env.GITHUB_DEFAULT_OWNER = originalEnv;
    }
  });

  it("should return undefined if no --repo flag is present", () => {
    expect(extractRepoFromInput("some random input")).toBeUndefined();
    expect(extractRepoFromInput("--notrepo foo")).toBeUndefined();
    expect(extractRepoFromInput("repo is foo/bar")).toBeUndefined();
  });

  it("should extract owner and name when provided as owner/name", () => {
    const result = extractRepoFromInput("run this --repo my-org/my-project");
    expect(result).toEqual({ owner: "my-org", name: "my-project" });
  });

  it("should use GITHUB_DEFAULT_OWNER when only name is provided", () => {
    process.env.GITHUB_DEFAULT_OWNER = "default-org";
    const result = extractRepoFromInput("--repo single-project");
    expect(result).toEqual({ owner: "default-org", name: "single-project" });
  });

  it("should use empty string for owner when only name provided and no default env set", () => {
    delete process.env.GITHUB_DEFAULT_OWNER;
    const result = extractRepoFromInput("--repo single-project");
    expect(result).toEqual({ owner: "", name: "single-project" });
  });

  it("should remove trailing punctuation from the parsed repo string", () => {
    expect(extractRepoFromInput("fix --repo org/repo.")).toEqual({
      owner: "org",
      name: "repo",
    });
    expect(extractRepoFromInput("--repo my-org/repo!")).toEqual({
      owner: "my-org",
      name: "repo",
    });
    expect(extractRepoFromInput("--repo my-org/repo,;")).toEqual({
      owner: "my-org",
      name: "repo",
    });
  });

  it("should handle multiple spaces after the --repo flag", () => {
    const result = extractRepoFromInput("fix --repo    some-org/some-repo");
    expect(result).toEqual({ owner: "some-org", name: "some-repo" });
  });

  it("should parse valid characters including underscores and dots", () => {
    const result = extractRepoFromInput("--repo _my.org-123/project_name.js");
    expect(result).toEqual({ owner: "_my.org-123", name: "project_name.js" });
  });

  it("should not match trailing invalid characters that break the regex", () => {
    // The regex specifies [a-zA-Z0-9_.-]+
    // If we have something like --repo org/name$
    // It should match org/name, but trailing punctuation stripping happens after regex.
    // The regex itself doesn't match '$'. Let's see what it does.
    const result = extractRepoFromInput("--repo org/name$");
    // match: org/name
    expect(result).toEqual({ owner: "org", name: "name" });
  });
});
