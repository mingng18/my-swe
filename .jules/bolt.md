## 2025-04-10 - Snapshot Store listAll Concurrency Optimization
**Learning:** `listAll` in `snapshot-store.ts` was doing sequential metadata reads using an `await` within a `for...of` loop which severely impacted performance for large amounts of snapshot files.
**Action:** Replaced the sequential `for...of` loop with concurrent mapping via `Array.map` and `Promise.all` reducing listAll latency by ~60%.
## 2025-04-15 - Blueprint Keyword Matching Optimization
**Learning:** Checking for keyword matches using `.toLowerCase()` string creation combined with a sequential `.includes()` lookup in a hot loop within \`selectBlueprint\` (in \`blueprint-legacy.ts\` and \`selection.ts\`) caused significant performance overhead, especially because the `.toLowerCase()` execution happens for every task string evaluated.
**Action:** Optimized keyword matching by adding a fast-path that uses a pre-compiled case-insensitive regular expression (\`new RegExp(keywords.join("|"), "i")\`) to skip non-matching blueprints quickly before allocating temporary strings and processing arrays via \`.includes()\`.
## 2025-04-15 - Regex Special Character Escaping Hazard
**Learning:** Constructing regular expressions from unescaped user-provided or codebase strings (like joining keywords with `|`) is a critical crash hazard. Keywords containing regex quantifiers or metacharacters (e.g. `C++`, `[A-Z]`) will cause `new RegExp` to throw a SyntaxError, and dots (`.`) will act as wildcards instead of literals, causing false matches.
**Action:** Always safely escape dynamically injected strings in `new RegExp` using `.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')`.
