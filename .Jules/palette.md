## 2025-02-18 - Tooltip Components vs Native Title Attributes
**Learning:** In the `swe-ui` Next.js frontend using Radix UI/shadcn Tooltip components, placing native HTML `title` attributes on a `<TooltipTrigger>` or the element inside it creates a poor UX because the browser will display the unstyled native tooltip *over* or next to the custom UI Tooltip, resulting in duplicate tooltips. Also, using native `title` on generic interactive elements like buttons is less polished than using standard custom tooltips for the app.
**Action:** When working on tooltips, never apply a native `title` to an element wrapped in a custom `<Tooltip>`. Use `aria-label` for screen reader accessibility, which does not trigger the browser's visual tooltip, leaving only the polished custom tooltip for sighted users. Upgrade native tooltips on primary actions to Radix tooltips where appropriate.
## 2024-07-27 - Replace native title with Custom Tooltips on Icon Buttons
**Learning:** Using native HTML `title` attributes on interactive elements in a UI framework using custom tooltips (like Radix/shadcn) creates a poor UX due to the native 2-second delay and risk of overlapping dual tooltips.
**Action:** Always replace native `title` attributes with styled `Tooltip` components (and remove `title=`) for icon-only buttons to guarantee immediate accessibility affordances and unified styling.

## 2026-07-20 - Improved Task Sidebar Accessibility
**Learning:** Using `role="status"` combined with visually hidden (`sr-only`) spans inside Badge components ensures screen readers announce dynamic counters properly. Converting generic `<div className="space-y-2">` lists to semantic `<ul>`/`<li>` structures provides critical list boundary and item count context for assistive tech.
**Action:** Always use semantic list elements (`<ul>`, `<ol>`, `<li>`) for lists of items and add contextual `sr-only` text alongside `role="status"` on dynamic counters.
