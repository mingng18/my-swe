import { describe, it, expect, beforeAll } from "bun:test";
import {
  CodebaseIndexer,
  type FileIndex,
  type CodebaseIndex,
} from "../codebase-indexer";
import { join } from "path";

// ---------------------------------------------------------------------------
// Use the indexer's own source as a real file for testing
// ---------------------------------------------------------------------------

const SRC_ROOT = join(import.meta.dir, "../../");
const INDEXER_PATH = join(SRC_ROOT, "indexing/codebase-indexer.ts");

let indexer: CodebaseIndexer;

beforeAll(() => {
  indexer = new CodebaseIndexer(SRC_ROOT);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CodebaseIndexer", () => {
  describe("indexFile", () => {
    it("indexes a real TypeScript file", async () => {
      const result: FileIndex = await indexer.indexFile(INDEXER_PATH);
      expect(result.filePath).toBe(INDEXER_PATH);
      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.imports.length).toBeGreaterThan(0);
      expect(result.exports.length).toBeGreaterThan(0);
      expect(result.lastModified).toBeGreaterThan(0);
    });

    it("extracts exported symbols from the indexer itself", async () => {
      const result = await indexer.indexFile(INDEXER_PATH);
      const symbolNames = result.symbols.map((s) => s.name);

      expect(symbolNames).toContain("CodebaseIndexer");
      expect(symbolNames).toContain("SymbolInfo");
      expect(symbolNames).toContain("FileIndex");
      expect(symbolNames).toContain("CodebaseIndex");
    });

    it("returns correct kinds for symbols", async () => {
      const result = await indexer.indexFile(INDEXER_PATH);
      const byName = new Map(result.symbols.map((s) => [s.name, s]));

      expect(byName.get("CodebaseIndexer")?.kind).toBe("class");
      expect(byName.get("SymbolInfo")?.kind).toBe("interface");
      expect(byName.get("FileIndex")?.kind).toBe("interface");
      expect(byName.get("CodebaseIndex")?.kind).toBe("interface");
    });

    it("marks exported symbols as exported", async () => {
      const result = await indexer.indexFile(INDEXER_PATH);
      const exported = result.symbols.filter((s) => s.exported);
      expect(exported.length).toBeGreaterThan(0);
    });

    it("returns empty index for nonexistent file", async () => {
      const result = await indexer.indexFile("/tmp/nonexistent_file_xyz.ts");
      expect(result.symbols).toHaveLength(0);
      expect(result.imports).toHaveLength(0);
      expect(result.exports).toHaveLength(0);
    });
  });

  describe("search", () => {
    let index: CodebaseIndex;

    beforeAll(async () => {
      index = await indexer.indexDirectory(
        join(SRC_ROOT, "indexing"),
        ["__tests__"],
      );
    });

    it("finds symbols by exact name", () => {
      const results = indexer.search("CodebaseIndexer", index);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.name).toBe("CodebaseIndexer");
    });

    it("finds symbols by fuzzy match (case-insensitive substring)", () => {
      const results = indexer.search("indexer", index);
      expect(results.length).toBeGreaterThan(0);
      const names = results.map((r) => r.name);
      expect(names.some((n) => n.includes("ndexer"))).toBe(true);
    });

    it("returns empty array for non-matching query", () => {
      const results = indexer.search("ZZZ_NONEXISTENT_SYMBOL", index);
      expect(results).toHaveLength(0);
    });
  });

  describe("formatForAgentContext", () => {
    it("produces readable output with file headers and exports", async () => {
      const index = await indexer.indexDirectory(
        join(SRC_ROOT, "indexing"),
        ["__tests__"],
      );
      const text = indexer.formatForAgentContext(index);
      expect(text).toContain("# Codebase Index");
      expect(text).toContain("codebase-indexer.ts");
      expect(text).toContain("CodebaseIndexer");
    });

    it("respects maxTokens limit", async () => {
      const index = await indexer.indexDirectory(
        join(SRC_ROOT, "indexing"),
        ["__tests__"],
      );
      const text = indexer.formatForAgentContext(index, 10);
      expect(text.length).toBeLessThan(200);
      expect(text).toContain("truncated");
    });
  });

  describe("import/export extraction regexes", () => {
    it("extracts imports from a known file", async () => {
      const result = await indexer.indexFile(INDEXER_PATH);
      expect(result.imports.length).toBeGreaterThan(0);
      const hasNodeImports = result.imports.some((imp) =>
        imp.includes("node:"),
      );
      expect(hasNodeImports).toBe(true);
    });

    it("extracts named re-exports (export { a, b })", async () => {
      const { writeFileSync, unlinkSync } = await import("node:fs");
      const tmpFile = join(SRC_ROOT, "indexing", "__test_fixture_exports.ts");
      writeFileSync(
        tmpFile,
        [
          "export { foo, bar } from './other';",
          "export * from './re-exported';",
        ].join("\n"),
      );

      try {
        const result = await indexer.indexFile(tmpFile);
        expect(result.exports).toContain("foo");
        expect(result.exports).toContain("bar");
      } finally {
        unlinkSync(tmpFile);
      }
    });

    it("extracts export const/let/var declarations", async () => {
      const { writeFileSync, unlinkSync } = await import("node:fs");
      const tmpFile = join(SRC_ROOT, "indexing", "__test_fixture_vars.ts");
      writeFileSync(
        tmpFile,
        [
          "export const MY_CONST = 42;",
          "export let myLet = 'hello';",
          "export var myVar = true;",
        ].join("\n"),
      );

      try {
        const result = await indexer.indexFile(tmpFile);
        expect(result.exports).toContain("MY_CONST");
        expect(result.exports).toContain("myLet");
        expect(result.exports).toContain("myVar");
      } finally {
        unlinkSync(tmpFile);
      }
    });

    it("extracts export function declarations", async () => {
      const { writeFileSync, unlinkSync } = await import("node:fs");
      const tmpFile = join(
        SRC_ROOT,
        "indexing",
        "__test_fixture_functions.ts",
      );
      writeFileSync(
        tmpFile,
        [
          "export function hello(name: string): string { return name; }",
          "export async function fetchData(url: string): Promise<Response> { return fetch(url); }",
        ].join("\n"),
      );

      try {
        const result = await indexer.indexFile(tmpFile);
        const names = result.symbols.map((s) => s.name);
        expect(names).toContain("hello");
        expect(names).toContain("fetchData");
        const hello = result.symbols.find((s) => s.name === "hello");
        expect(hello?.kind).toBe("function");
      } finally {
        unlinkSync(tmpFile);
      }
    });
  });
});
