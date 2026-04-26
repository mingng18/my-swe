import { describe, it, expect } from "bun:test";
import {
  getReviewersForFile,
  getReviewersForFiles,
  shouldReviewerReviewFile,
} from "../reviewerMapping";

describe("getReviewersForFile", () => {
  it(".go files → ['code-reviewer', 'go-reviewer']", () => {
    expect(getReviewersForFile("main.go")).toEqual([
      "code-reviewer",
      "go-reviewer",
    ]);
    expect(getReviewersForFile("utils/helper.go")).toEqual([
      "code-reviewer",
      "go-reviewer",
    ]);
  });

  it("auth.go files → ['code-reviewer', 'go-reviewer', 'security-reviewer']", () => {
    expect(getReviewersForFile("auth.go")).toEqual([
      "code-reviewer",
      "go-reviewer",
      "security-reviewer",
    ]);
  });

  it(".py files → ['code-reviewer', 'python-reviewer']", () => {
    expect(getReviewersForFile("main.py")).toEqual([
      "code-reviewer",
      "python-reviewer",
    ]);
    expect(getReviewersForFile("utils/helper.py")).toEqual([
      "code-reviewer",
      "python-reviewer",
    ]);
  });

  it("auth.py files → ['code-reviewer', 'python-reviewer', 'security-reviewer']", () => {
    expect(getReviewersForFile("auth.py")).toEqual([
      "code-reviewer",
      "python-reviewer",
      "security-reviewer",
    ]);
  });

  it(".sql files → ['code-reviewer', 'database-reviewer']", () => {
    expect(getReviewersForFile("query.sql")).toEqual([
      "code-reviewer",
      "database-reviewer",
    ]);
    expect(getReviewersForFile("schema.sql")).toEqual([
      "code-reviewer",
      "database-reviewer",
    ]);
    expect(getReviewersForFile("db/migration.sql")).toEqual([
      "code-reviewer",
      "database-reviewer",
    ]);
  });

  it("auth/login files → ['code-reviewer', 'typescript-reviewer', 'security-reviewer']", () => {
    expect(getReviewersForFile("auth/login.js")).toEqual([
      "code-reviewer",
      "security-reviewer",
    ]);
    expect(getReviewersForFile("auth/login.php")).toEqual([
      "code-reviewer",
      "security-reviewer",
    ]);
    expect(getReviewersForFile("login/index.ts")).toEqual([
      "code-reviewer",
      "typescript-reviewer",
      "security-reviewer",
    ]);
  });

  it("auth/login.py files → ['code-reviewer', 'python-reviewer', 'security-reviewer']", () => {
    expect(getReviewersForFile("auth/login.py")).toEqual([
      "code-reviewer",
      "python-reviewer",
      "security-reviewer",
    ]);
  });

  it("API files → ['code-reviewer', 'typescript-reviewer', 'security-reviewer']", () => {
    expect(getReviewersForFile("api/users.ts")).toEqual([
      "code-reviewer",
      "typescript-reviewer",
      "security-reviewer",
    ]);
    expect(getReviewersForFile("api/v1/products.js")).toEqual([
      "code-reviewer",
      "security-reviewer",
    ]);
    expect(getReviewersForFile("endpoints/auth.php")).toEqual([
      "code-reviewer",
      "security-reviewer",
    ]);
  });

  it("README.md → ['code-reviewer']", () => {
    expect(getReviewersForFile("README.md")).toEqual(["code-reviewer"]);
    expect(getReviewersForFile("docs/README.md")).toEqual(["code-reviewer"]);
  });
});

describe("getReviewersForFiles", () => {
  it("Multiple files return unique reviewers", () => {
    const files = ["main.go", "main.py", "query.sql"];
    expect(getReviewersForFiles(files)).toEqual([
      "code-reviewer",
      "go-reviewer",
      "python-reviewer",
      "database-reviewer",
    ]);
  });

  it("Deduplicates reviewers", () => {
    const files = ["main.go", "test.go", "api/users.ts"];
    expect(getReviewersForFiles(files)).toEqual([
      "code-reviewer",
      "go-reviewer",
      "typescript-reviewer",
      "security-reviewer",
    ]);
  });
});

describe("shouldReviewerReviewFile", () => {
  it("Returns true when reviewer matches", () => {
    expect(shouldReviewerReviewFile("main.go", "go-reviewer")).toBe(true);
    expect(shouldReviewerReviewFile("main.py", "python-reviewer")).toBe(true);
    expect(shouldReviewerReviewFile("query.sql", "database-reviewer")).toBe(
      true,
    );
    expect(shouldReviewerReviewFile("auth/login.js", "security-reviewer")).toBe(
      true,
    );
    expect(shouldReviewerReviewFile("api/users.ts", "security-reviewer")).toBe(
      true,
    );
  });

  it("Returns false when reviewer doesn't match", () => {
    expect(shouldReviewerReviewFile("main.go", "python-reviewer")).toBe(false);
    expect(shouldReviewerReviewFile("main.py", "go-reviewer")).toBe(false);
    expect(shouldReviewerReviewFile("query.sql", "security-reviewer")).toBe(
      false,
    );
    expect(shouldReviewerReviewFile("auth/login.js", "database-reviewer")).toBe(
      false,
    );
    expect(shouldReviewerReviewFile("README.md", "go-reviewer")).toBe(false);
  });

  it("Returns true for code-reviewer on any file", () => {
    expect(shouldReviewerReviewFile("main.go", "code-reviewer")).toBe(true);
    expect(shouldReviewerReviewFile("main.py", "code-reviewer")).toBe(true);
    expect(shouldReviewerReviewFile("query.sql", "code-reviewer")).toBe(true);
    expect(shouldReviewerReviewFile("auth/login.js", "code-reviewer")).toBe(
      true,
    );
    expect(shouldReviewerReviewFile("api/users.ts", "code-reviewer")).toBe(
      true,
    );
    expect(shouldReviewerReviewFile("README.md", "code-reviewer")).toBe(true);
  });
});
