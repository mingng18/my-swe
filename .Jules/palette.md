## 2025-02-18 - Tooltip Components vs Native Title Attributes
**Learning:** In the `swe-ui` Next.js frontend using Radix UI/shadcn Tooltip components, placing native HTML `title` attributes on a `<TooltipTrigger>` or the element inside it creates a poor UX because the browser will display the unstyled native tooltip *over* or next to the custom UI Tooltip, resulting in duplicate tooltips. Also, using native `title` on generic interactive elements like buttons is less polished than using standard custom tooltips for the app.
**Action:** When working on tooltips, never apply a native `title` to an element wrapped in a custom `<Tooltip>`. Use `aria-label` for screen reader accessibility, which does not trigger the browser's visual tooltip, leaving only the polished custom tooltip for sighted users. Upgrade native tooltips on primary actions to Radix tooltips where appropriate.
## 2024-07-27 - Replace native title with Custom Tooltips on Icon Buttons
**Learning:** Using native HTML `title` attributes on interactive elements in a UI framework using custom tooltips (like Radix/shadcn) creates a poor UX due to the native 2-second delay and risk of overlapping dual tooltips.
**Action:** Always replace native `title` attributes with styled `Tooltip` components (and remove `title=`) for icon-only buttons to guarantee immediate accessibility affordances and unified styling.
## 2025-05-15 - Semantic List Elements for Todo Sidebar
**Learning:** Generic block elements like `<div>` lack structure and aren't properly parsed by screen readers when used in lists, leading to context loss. Converting generic list elements into semantic `<ol>` or `<ul>` along with `<li>` tags properly notifies assistive tech that a list of items exists and allows for correct numbering and list counts.
**Action:** Use semantic list tags `<ol>`, `<ul>`, and `<li>` when rendering collections of elements like tasks or messages, ensuring that empty states are handled cleanly outside the list block.
## 2026-08-01 - Removed redundant Checkbox
**Learning:** Using a disabled Checkbox alongside an icon for status creates a redundant and inaccessible (poor contrast) element that implies interactivity where none exists for an agent-driven list.
**Action:** Repositioned the status icon as the primary non-interactive indicator and removed the Checkbox to streamline the Todo item layout.
## 2025-08-03 - Dialog Close Tooltip
**Learning:** Native HTML `title` attributes on custom Dialog component close buttons create the same poor duplicate/delayed tooltip UX as on regular buttons when used in a UI framework heavily utilizing custom Radix Tooltips.
**Action:** Always replace native `title` attributes on Dialog close buttons with custom `Tooltip` components, ensuring proper `asChild` prop composition (`TooltipTrigger` -> `DialogPrimitive.Close` -> `Button`) to preserve accessible interactions.
