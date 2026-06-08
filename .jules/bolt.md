## 2024-05-30 - Added error path testing for tool-factory
**Learning:** Testing error paths effectively in Bullhorse/MCP setups often requires mutable state mocks using `bun:test`'s `mock.module` and manipulating the state using `beforeEach` loops to prevent state leakage and provide dynamic errors across individual tests.
**Action:** Always wrap state dependency of external mock modules in mutable shared objects cleared at the test boundary to keep tests reliable.
