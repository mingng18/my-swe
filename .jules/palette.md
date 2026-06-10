## 2025-06-04 - Default ARIA labels on reusable components
**Learning:** When adding default `aria-label` attributes to reusable UI components like triggers or custom buttons, it's a good practice to place the hardcoded attribute before the spread operator `{...props}`.
**Action:** Always structure accessible fallbacks as `<Component aria-label="Default" {...props}>` to allow consumers to override the default text when context requires it.
## 2026-06-10 - Verifying Staged File Modifications
**Learning:** File modifications made via terminal scripts or tools may be automatically staged by the environment. If `git diff` yields no output after editing a file, always check `git status` and use `git diff --staged` to verify your changes.
**Action:** Default to running `git status` immediately after bulk file modifications, rather than solely relying on `git diff`, to accurately determine the state of the modified files.
