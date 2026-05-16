import { test, expect, describe } from "bun:test";
import { extractRepoFromInput } from "../repo-parser";

describe("extractRepoFromInput", () => {
  const originalEnv = process.env.GITHUB_DEFAULT_OWNER;

  test("extracts repo with owner and name", () => {
    const input = "Fix a bug --repo facebook/react";
    const result = extractRepoFromInput(input);
    expect(result).toEqual({ owner: "facebook", name: "react" });
  });

  test("extracts repo with only name using default owner", () => {
    process.env.GITHUB_DEFAULT_OWNER = "myorg";
    const input = "Fix a bug --repo my-repo";
    const result = extractRepoFromInput(input);
    expect(result).toEqual({ owner: "myorg", name: "my-repo" });
    process.env.GITHUB_DEFAULT_OWNER = originalEnv;
  });

  test("strips trailing punctuation", () => {
    const input = "I need this in --repo foo/bar.";
    const result = extractRepoFromInput(input);
    expect(result).toEqual({ owner: "foo", name: "bar" });
  });

  test("returns undefined if no match", () => {
    const input = "Fix a bug without repo flag";
    const result = extractRepoFromInput(input);
    expect(result).toBeUndefined();
  });
});
