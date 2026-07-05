import { describe, expect, test } from "bun:test";
import { getImportsSection } from "../progressive-file-reader";

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
