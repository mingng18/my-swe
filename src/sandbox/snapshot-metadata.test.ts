import { describe, test, expect } from "bun:test";
import { parseSnapshotKey } from "./snapshot-metadata";

describe("parseSnapshotKey", () => {
  test("returns valid SnapshotKey for a correctly formatted string", () => {
    const keyString = "owner/repo/typescript/main";
    const result = parseSnapshotKey(keyString);
    expect(result).toEqual({
      repoOwner: "owner",
      repoName: "repo",
      profile: "typescript",
      branch: "main",
    });
  });

  test("returns null if parts length is less than 4", () => {
    const keyString = "owner/repo/typescript";
    expect(parseSnapshotKey(keyString)).toBeNull();
  });

  test("returns null if parts length is greater than 4", () => {
    const keyString = "owner/repo/typescript/main/extra";
    expect(parseSnapshotKey(keyString)).toBeNull();
  });

  test("returns null for unsupported profiles", () => {
    const keyString = "owner/repo/csharp/main";
    expect(parseSnapshotKey(keyString)).toBeNull();
  });

  test("returns valid SnapshotKey for all supported profiles", () => {
    const profiles = ["typescript", "javascript", "python", "java", "polyglot"];
    for (const profile of profiles) {
      const keyString = `owner/repo/${profile}/main`;
      const result = parseSnapshotKey(keyString);
      expect(result).toEqual({
        repoOwner: "owner",
        repoName: "repo",
        profile: profile as any,
        branch: "main",
      });
    }
  });

  test("returns null for empty strings (incorrect parts length or invalid profile)", () => {
    expect(parseSnapshotKey("")).toBeNull();
    // "///" splits to 4 empty parts, but "" is not a valid profile.
    expect(parseSnapshotKey("///")).toBeNull();
  });
});
