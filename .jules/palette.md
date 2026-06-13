## 2025-06-04 - Default ARIA labels on reusable components
**Learning:** When adding default `aria-label` attributes to reusable UI components like triggers or custom buttons, it's a good practice to place the hardcoded attribute before the spread operator `{...props}`.
**Action:** Always structure accessible fallbacks as `<Component aria-label="Default" {...props}>` to allow consumers to override the default text when context requires it.
## YYYY-MM-DD - Icon Button Accessibility
**Learning:** When using icon-only buttons (like copy buttons), pairing `aria-label` for screen readers with a native `title` attribute provides a lightweight, native tooltip on hover without needing complex React Tooltip component wrappers.
**Action:** Always add both `aria-label` and `title` to icon-only action buttons for simultaneous accessibility and visual feedback.
