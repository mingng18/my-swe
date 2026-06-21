/**
 * Sample evaluation cases for the SWE-bench-lite harness.
 *
 * These cases demonstrate the three primary eval patterns:
 *  1. Issue-based with verification commands (type-error fix)
 *  2. Issue-based with file-change checks (missing export)
 *  3. Description-only, docs-only verification (async refactor)
 */

import type { EvalCase } from "./harness";

export const SAMPLE_EVAL_CASES: EvalCase[] = [
  // -----------------------------------------------------------------------
  // Case 1: Fix a simple TypeScript type error in a test file
  // -----------------------------------------------------------------------
  {
    id: "fix-type-error-test",
    repo: "example-org/typescript-lib",
    issueNumber: 42,
    description:
      "The test file `src/__tests__/utils.test.ts` has a TypeScript type error on line 15: " +
      "`Property 'format' does not exist on type 'string'`. Fix the type annotation so " +
      "that `bunx tsc --noEmit` passes without errors.",
    verificationCommands: [
      "bun install --frozen-lockfile",
      "bunx tsc --noEmit",
      "bun test src/__tests__/utils.test.ts",
    ],
    expectedFilesChanged: ["src/__tests__/utils.test.ts"],
  },

  // -----------------------------------------------------------------------
  // Case 2: Add a missing export to an index.ts barrel
  // -----------------------------------------------------------------------
  {
    id: "add-missing-export-barrel",
    repo: "example-org/typescript-lib",
    issueNumber: 57,
    description:
      "The module `src/utils/format.ts` exports `formatDate()` but it is not re-exported " +
      "from `src/index.ts`. Add the missing export so consumers can import it as " +
      "`import { formatDate } from 'typescript-lib'`. Also update the unit tests.",
    setupCommands: ["bun install --frozen-lockfile"],
    verificationCommands: [
      "bunx tsc --noEmit",
      "bun test",
    ],
    expectedFilesChanged: ["src/index.ts", "src/__tests__/index.test.ts"],
  },

  // -----------------------------------------------------------------------
  // Case 3: Refactor a function to use async/await (docs-only, no verification)
  // -----------------------------------------------------------------------
  {
    id: "refactor-to-async-await",
    repo: "example-org/typescript-lib",
    issueNumber: 0,
    description:
      "Refactor `src/utils/fetchData.ts` to replace the Promise-chain style " +
      "(`.then()` / `.catch()`) with modern `async`/`await`. Update the JSDoc comments " +
      "to document that the function is now async. No functional behavior should change. " +
      "This is a docs-and-style refactor; there are no automated verification commands.",
    // No verificationCommands — PR existence counts as pass.
    expectedFilesChanged: ["src/utils/fetchData.ts"],
  },
];
