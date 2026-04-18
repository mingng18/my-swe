import { describe, expect, test } from "bun:test";
import { addPrCollaborationNote } from "./authorship";

describe("addPrCollaborationNote", () => {
  const prBody = "This is a PR body.";

  test("returns original PR body when no identity fields are provided", () => {
    const result = addPrCollaborationNote(prBody, {});
    expect(result).toBe(prBody);
  });

  test("adds note with githubUsername and (identity unconfirmed)", () => {
    const result = addPrCollaborationNote(prBody, {
      githubUsername: "testuser",
    });
    expect(result).toBe(
      `${prBody}\n\n---\n\n*This PR was created on behalf of @testuser. (identity unconfirmed)*`,
    );
  });

  test("adds note with githubUsername and confirmed identity", () => {
    const result = addPrCollaborationNote(prBody, {
      githubUsername: "testuser",
      isResolved: true,
    });
    expect(result).toBe(
      `${prBody}\n\n---\n\n*This PR was created on behalf of @testuser.*`,
    );
  });

  test("adds note with telegramUsername and (identity unconfirmed)", () => {
    const result = addPrCollaborationNote(prBody, {
      telegramUsername: "testuser",
    });
    expect(result).toBe(
      `${prBody}\n\n---\n\n*This PR was created on behalf of Telegram user @testuser. (identity unconfirmed)*`,
    );
  });

  test("adds note with name and (identity unconfirmed)", () => {
    const result = addPrCollaborationNote(prBody, { name: "Test User" });
    expect(result).toBe(
      `${prBody}\n\n---\n\n*This PR was created on behalf of Test User. (identity unconfirmed)*`,
    );
  });

  test("prioritizes githubUsername over telegramUsername", () => {
    const result = addPrCollaborationNote(prBody, {
      githubUsername: "githubuser",
      telegramUsername: "telegramuser",
    });
    expect(result).toBe(
      `${prBody}\n\n---\n\n*This PR was created on behalf of @githubuser. (identity unconfirmed)*`,
    );
  });

  test("prioritizes telegramUsername over name", () => {
    const result = addPrCollaborationNote(prBody, {
      telegramUsername: "telegramuser",
      name: "Test User",
    });
    expect(result).toBe(
      `${prBody}\n\n---\n\n*This PR was created on behalf of Telegram user @telegramuser. (identity unconfirmed)*`,
    );
  });
});
