## $(date +%Y-%m-%d) - JSON.stringify Performance Bottleneck on Large Object Arrays
**Learning:** Using `JSON.stringify` to serialize massive arrays of complex objects (like LangChain message histories) merely to estimate text length or token count causes severe event loop blocking and memory churn in Node.js/Bun.
**Action:** Always favor manual iteration with purpose-built helper functions (e.g., `estimateMessageTokens`) when aggregating sizes or tokens across large arrays, avoiding unnecessary serialization overhead.
