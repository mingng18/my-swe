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
## 2026-08-02 - Tooltip Component Composition with Dialogs
**Learning:** When adding custom Tooltips to Dialog close buttons in Radix UI, the `<Tooltip>` cannot wrap the `<DialogPrimitive.Close asChild>` directly without a `<TooltipTrigger asChild>`. Additionally, `<TooltipTrigger asChild>` MUST wrap `<DialogPrimitive.Close asChild>`, which in turn wraps the `<Button>`. This ensures the `onClick` event handlers from both the Dialog close behavior and the Tooltip trigger behavior are correctly passed down to the inner button.
**Action:** When composing Tooltips over other interactive Radix primitives that use `asChild`, strictly ensure the trigger wrappers are nested correctly so event handlers aren't broken.

## 2024-05-15 - Tooltips for Disabled Buttons
**Learning:** Radix UI Tooltips do not trigger on elements with `disabled:pointer-events-none` because the events are blocked. Wrapping disabled elements in a `<span>` with `tabIndex={0}` allows tooltips to be accessible and trigger correctly on hover and focus.
**Action:** Always wrap disabled buttons in an accessible `<span>` or `<div>` wrapper when adding tooltips to explain their disabled state.
## 2026-08-09 - Replaced native title with Tooltip in Toast
**Learning:** Using native HTML title attributes on interactive icon-only buttons creates a duplicate, unstyled tooltip with a delay. Wrapping it in a custom UI <Tooltip> component instead improves accessibility and UX.
**Action:** Use <Tooltip> with an aria-label for screen readers instead of native title attributes on icon-only buttons.
