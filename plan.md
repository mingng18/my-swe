1. **Optimize `summarizeRemovedMessages` in `src/utils/context-compactor.ts`**
   - Replace the multiple `.filter(...).length` calls with a single `for` loop to compute `toolCalls` and `aiMessages` in one pass. This avoids iterating over the `removed` array twice.
   - This optimization follows the principle of avoiding multiple passes when calculating statistics over arrays.

2. **Optimize `getRateLimitWindow` in `src/utils/rate-limit.ts`**
   - Replace the two `.filter(...).length` calls for `minuteCount` and `hourCount` with a single `for` loop. This avoids iterating over the `timestamps` array twice.
   - This optimization also avoids multiple passes.

3. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**
   - Call `pre_commit_instructions` and follow the provided steps.

4. **Submit the PR**
   - Use the `submit` tool to create a PR with the title `⚡ Bolt: Optimize array traversals in context compactor and rate limiter` and appropriate description.
