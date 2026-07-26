## 2025-02-18 - Tooltip Components vs Native Title Attributes
**Learning:** In the `swe-ui` Next.js frontend using Radix UI/shadcn Tooltip components, placing native HTML `title` attributes on a `<TooltipTrigger>` or the element inside it creates a poor UX because the browser will display the unstyled native tooltip *over* or next to the custom UI Tooltip, resulting in duplicate tooltips. Also, using native `title` on generic interactive elements like buttons is less polished than using standard custom tooltips for the app.
**Action:** When working on tooltips, never apply a native `title` to an element wrapped in a custom `<Tooltip>`. Use `aria-label` for screen reader accessibility, which does not trigger the browser's visual tooltip, leaving only the polished custom tooltip for sighted users. Upgrade native tooltips on primary actions to Radix tooltips where appropriate.
## 2026-07-24 - Prevent Duplicate Tooltips

**Learning:** When using custom UI Tooltip components (like Radix UI's Tooltip), also defining native HTML `title` attributes on the same element or its trigger causes the browser to render a second native tooltip overlapping the custom one.

**Action:** Remove native `title` attributes from elements that are already wrapped in custom `<Tooltip>` components, ensuring we keep `aria-label` for screen reader accessibility without visual duplication.
