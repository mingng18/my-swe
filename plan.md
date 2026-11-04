1. **Optimize Rate Limiter (`src/utils/rate-limit.ts`)**:
   - Replace the `.filter()` usage on chronological event buffers with an in-place `splice()` to remove stale timestamps, and use simple iteration to count recent ones instead of creating new arrays on every request. (Done)
2. **Verify functionality**:
   - Delete temporary files (`run_in_bash_session` with `rm patch_script.js test-rate-limit.ts optimize-rate-limit.ts`). (Done)
   - Type check and run tests (`bunx tsc --noEmit` and `bun test`). (Done)
3. **Complete pre commit steps**:
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
4. **Use the `submit` tool to create the PR**:
   - Title: `⚡ Bolt: [performance improvement]`
   - Description must include:
     * 💡 What: Replaced array allocations (.filter) with in-place mutations (.splice) in rate limiter.
     * 🎯 Why: To reduce GC pressure and CPU overhead on every API request.
     * 📊 Impact: Significant reduction in memory allocations and faster execution times.
     * 🔬 Measurement: Benchmark script comparing the old and new methods.
