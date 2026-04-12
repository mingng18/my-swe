🎯 **What:**
Added a dedicated test suite for the `extractPrParamsFromMessages` pure function within the `src/middleware/open-pr.ts` file, resolving a testing coverage gap.

📊 **Coverage:**
The new test suite covers:
- Returns `null` for an empty messages array.
- Returns `null` when no `commit_and_open_pr` tool result exists in the messages.
- Successfully extracts the payload when `content` is a stringified JSON.
- Successfully extracts the payload when `content` is a plain object.
- Returns the *most recent* valid tool result when multiple exist.
- Ignores messages with invalid JSON strings, falling back to earlier messages.
- Ignores messages with missing or null content.
- Ignores messages with non-string/non-object content.
- Returns null if the parsed content is not an object.

✨ **Result:**
Test coverage for the `open-pr.ts` middleware is vastly improved. We now verify the parsing logic works flawlessly and safely catches exceptions without crashing the middleware execution.
