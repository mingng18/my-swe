## 2025-06-04 - Default ARIA labels on reusable components
**Learning:** When adding default `aria-label` attributes to reusable UI components like triggers or custom buttons, it's a good practice to place the hardcoded attribute before the spread operator `{...props}`.
**Action:** Always structure accessible fallbacks as `<Component aria-label="Default" {...props}>` to allow consumers to override the default text when context requires it.
