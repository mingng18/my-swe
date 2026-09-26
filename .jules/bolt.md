## 2026-09-17 - Extracted array creation from React useCallback in PromptInput
**Learning:** In PromptInput.tsx, the `matchesAccept` function inside `useCallback` was repeatedly chaining `.split(",").map((s) => s.trim()).filter(Boolean)` on the `accept` string property to validate each incoming file. Since the `accept` prop rarely changes, this caused redundant intermediate array allocations and overhead when multiple files were dropped.
**Action:** Extract static string parsing and filtering logic from inside per-item iterative `useCallback` loops into a `useMemo` block that depends only on the prop string, reusing the array mapping once per change.

## 2026-09-22 - Optimize chronological array pruning
**Learning:** Pruning old elements from chronological arrays with `.filter()` creates unnecessary O(N) intermediate array allocations and causes GC pressure, while `Math.min(...timestamps)` can crash with large arrays.
**Action:** Use single-pass `while` loops to find cutoffs and mutate in-place with `array.splice()`, leveraging the sorted nature of the array.

## 2026-09-26 - Optimize array chains in memory consolidation
**Learning:** Chained array methods like `.map().filter(Boolean)` or `.reduce()` on memory consolidation operations allocate intermediate arrays and add garbage collection overhead during background cleanup processes.
**Action:** Replace these array chains with single-pass `for` loops to minimize intermediate allocations in memory aggregation routines.
