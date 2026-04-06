## 2025-04-06 - Pre-computing properties in hot loop
**Learning:** String allocations and case conversions inside iterative lookup loops (`blueprint.triggerKeywords.map(k => k.toLowerCase())` within a loop) create substantial O(n * m) overhead in Node/Bun when the function is invoked frequently.
**Action:** When working on hot paths like graph or registry selections that execute thousands of times per turn, extract dynamic object manipulation (`toLowerCase`, `find`, etc.) to application setup/registration time instead of executing them inline inside `select()` or `find()` functions.
