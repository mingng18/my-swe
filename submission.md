🎯 **What:** Extracted duplicated implementations of `extractRepoFromInput`, `getSandboxProfileFromEnv`, and `SandboxProfile` into a shared utility file `src/utils/repo.ts`.
💡 **Why:** Reduces code duplication, unifies the slightly diverged implementation logic gracefully across `supabaseRepoMemory.ts` and `deepagents.ts`, and improves overall maintainability.
✅ **Verification:** Ran `bun test` ensuring all tests pass flawlessly, and checked compilation and formatting manually.
✨ **Result:** A cleaner codebase with a single source of truth for extracting sandbox profiles and GitHub repositories from user inputs.
