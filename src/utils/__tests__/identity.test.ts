import { describe, it, expect } from "bun:test";
import { getEmailForIdentity, IDENTITY_MAP } from "../identity";

describe("getEmailForIdentity", () => {
  it("should return the correct email for a known telegram platform mapping", () => {
    // According to the code, "telegram:Minng02" maps to "n.gihming@yahoo.com"
    expect(getEmailForIdentity("telegram", "Minng02")).toBe(
      "n.gihming@yahoo.com"
    );
  });

  it("should return the correct email for a known github platform mapping", () => {
    // Assuming GITHUB_USER_EMAIL_MAP has "langchain-infra"
    const githubEmail = getEmailForIdentity("github", "langchain-infra");
    expect(githubEmail).toBe("mukil@langchain.dev");
  });

  it("should return the correct email for another known github platform mapping", () => {
    // Assuming GITHUB_USER_EMAIL_MAP has "joshuatagoe"
    const githubEmail = getEmailForIdentity("github", "joshuatagoe");
    expect(githubEmail).toBe("joshua.tagoe@langchain.dev");
  });

  it("should return undefined for an unknown identity on any platform", () => {
    expect(getEmailForIdentity("telegram", "unknown_user_123")).toBeUndefined();
    expect(getEmailForIdentity("github", "unknown_user_123")).toBeUndefined();
    expect(getEmailForIdentity("linear", "unknown_user_123")).toBeUndefined();
    expect(getEmailForIdentity("slack", "unknown_user_123")).toBeUndefined();
  });
});
