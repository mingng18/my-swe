## 2025-02-18 - Tooltip Components vs Native Title Attributes
**Learning:** In the `swe-ui` Next.js frontend using Radix UI/shadcn Tooltip components, placing native HTML `title` attributes on a `<TooltipTrigger>` or the element inside it creates a poor UX because the browser will display the unstyled native tooltip *over* or next to the custom UI Tooltip, resulting in duplicate tooltips. Also, using native `title` on generic interactive elements like buttons is less polished than using standard custom tooltips for the app.
**Action:** When working on tooltips, never apply a native `title` to an element wrapped in a custom `<Tooltip>`. Use `aria-label` for screen reader accessibility, which does not trigger the browser's visual tooltip, leaving only the polished custom tooltip for sighted users. Upgrade native tooltips on primary actions to Radix tooltips where appropriate.
## 2024-07-27 - Replace native title with Custom Tooltips on Icon Buttons
**Learning:** Using native HTML `title` attributes on interactive elements in a UI framework using custom tooltips (like Radix/shadcn) creates a poor UX due to the native 2-second delay and risk of overlapping dual tooltips.
**Action:** Always replace native `title` attributes with styled `Tooltip` components (and remove `title=`) for icon-only buttons to guarantee immediate accessibility affordances and unified styling.

## 2023-10-25 - Contextual Actions and Hover States
**Learning:** Adding contextual actions (like copy to clipboard) inside chat bubbles using `group-hover` combined with `focus-visible` provides excellent accessibility without cluttering the UI with persistent icons. The `focus-visible` ensures keyboard users can still access the button cleanly.
**Action:** Always pair `group-hover:opacity-100` with `focus-visible:opacity-100` on interactive elements within lists or chat interfaces to maintain both a clean visual design and strict accessibility support.
