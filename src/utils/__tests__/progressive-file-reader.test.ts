import { describe, expect, test } from "bun:test";
import { getImportsSection, getExports } from "../progressive-file-reader";

describe("getImportsSection", () => {
  test("extracts standard import statements", () => {
    const content = `import { useState } from 'react';
import { createLogger } from "./logger";
import path from "path";

const logger = createLogger("test");
`;
    const expected = `import { useState } from 'react';
import { createLogger } from "./logger";
import path from "path";
`;
    expect(getImportsSection(content)).toBe(expected);
  });

  test("extracts other module statements (export, require, from)", () => {
    const content = `export * from './module';
require('dotenv').config();
from 'somewhere' import something;

function test() {}
`;
    const expected = `export * from './module';
require('dotenv').config();
from 'somewhere' import something;
`;
    expect(getImportsSection(content)).toBe(expected);
  });

  test("stops when encountering non-import lines", () => {
    const content = `import a from 'a';
const x = 1;
import b from 'b';
`;
    const expected = `import a from 'a';`;
    expect(getImportsSection(content)).toBe(expected);
  });

  test("enforces maxLines parameter", () => {
    const content = `import a from 'a';
import b from 'b';
import c from 'c';
import d from 'd';
`;
    const expected = `import a from 'a';
import b from 'b';`;
    expect(getImportsSection(content, 2)).toBe(expected);
  });

  test("returns empty string for empty input", () => {
    expect(getImportsSection("")).toBe("");
  });

  test("extracts imports even if they don't start on line 1", () => {
    const content = `const x = 1;
import a from 'a';
`;
    const expected = `import a from 'a';\n`;
    expect(getImportsSection(content)).toBe(expected);
  });

  test("ignores leading blank lines if no imports found yet", () => {
    const content = `

import a from 'a';
`;
    const expected = `import a from 'a';\n`;
    expect(getImportsSection(content)).toBe(expected);
  });
});

describe("getExports", () => {
  it("should extract regular function exports", () => {
    const source = "export function parseYAML() {}";
    const result = getExports(source);
    expect(result).toEqual([{ name: "parseYAML", line: 1 }]);
  });

  it("should extract async function exports", () => {
    const source = "export async function fetchData() {}";
    const result = getExports(source);
    expect(result).toEqual([{ name: "fetchData", line: 1 }]);
  });

  it("should extract class exports", () => {
    const source = "export class DataManager {}";
    const result = getExports(source);
    expect(result).toEqual([{ name: "DataManager", line: 1 }]);
  });

  it("should extract const exports", () => {
    const source = "export const MAX_LIMIT = 100;";
    const result = getExports(source);
    expect(result).toEqual([{ name: "MAX_LIMIT", line: 1 }]);
  });

  it("should extract default const exports", () => {
    const source = "export default const Config = {};";
    const result = getExports(source);
    expect(result).toEqual([{ name: "Config", line: 1 }]);
  });

  it("should extract named exports block", () => {
    const source = "export { validateInput, formatOutput };";
    const result = getExports(source);
    expect(result).toEqual([
      { name: "validateInput", line: 1 },
      { name: "formatOutput", line: 1 },
    ]);
  });

  it("should correctly identify line numbers across multiple lines", () => {
    const source = `import { something } from "somewhere";

export function helper1() {}

// some comment
export const config = {};
`;
    const result = getExports(source);
    expect(result).toEqual([
      { name: "helper1", line: 3 },
      { name: "config", line: 6 },
    ]);
  });

  it("should ignore lines that do not start with export", () => {
    const source = `
      function internalHelper() {}
      const internalConst = 1;
      class InternalClass {}
      export function exposedFunction() {}
    `;
    const result = getExports(source);
    expect(result).toEqual([{ name: "exposedFunction", line: 5 }]);
  });

  it("should handle exports with extra whitespace", () => {
    const source = "export    async   function   spacedFunction() {}";
    const result = getExports(source);
    expect(result).toEqual([{ name: "spacedFunction", line: 1 }]);
  });

  it("should ignore lines with export keyword not at the beginning", () => {
    const source = `
      // this is an export function
      const str = "export function";
      export function realExport() {}
    `;
    const result = getExports(source);
    expect(result).toEqual([{ name: "realExport", line: 4 }]);
  });
});
