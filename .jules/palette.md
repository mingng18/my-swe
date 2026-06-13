## 2025-06-04 - Default ARIA labels on reusable components
**Learning:** When adding default `aria-label` attributes to reusable UI components like triggers or custom buttons, it's a good practice to place the hardcoded attribute before the spread operator `{...props}`.
**Action:** Always structure accessible fallbacks as `<Component aria-label="Default" {...props}>` to allow consumers to override the default text when context requires it.

## 2024-05-18 - Missing ARIA labels on Icon-only buttons
**Learning:** Found multiple icon-only `<Button size="icon">` components in `swe-ui/components/ai-elements/` missing `aria-label` attributes, which makes them inaccessible to screen readers.
**Action:** Always add an `aria-label` or explicitly visible text to buttons, especially icon-only actions. I patched multiple components (`terminal.tsx`, `commit.tsx`, `queue.tsx`, `environment-variables.tsx`, `code-block.tsx`, `stack-trace.tsx`, `plan.tsx`, `audio-player.tsx`) to add meaningful accessible names for screen readers.
