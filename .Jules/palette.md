## 2026-07-19 - Added ARIA attributes to Agent Thread Monitor
**Learning:** For continuous live-updating chat logs or event streams (like ThreadTimeline), adding `role="log"` and `aria-live="polite"` automatically notifies screen readers of incoming messages without requiring manual user navigation, massively improving accessibility. Similarly, wrapping status indicators (like connection state in ThreadHeader) with `role="status" aria-live="polite"` is crucial for conveying realtime system states.
**Action:** Always wrap dynamic lists of messages, feeds, and critical status indicators with appropriate ARIA live regions so assistive tech can gracefully announce state changes as they happen.

## 2026-07-20 - Improved Task Sidebar Accessibility
**Learning:** Using `role="status"` combined with visually hidden (`sr-only`) spans inside Badge components ensures screen readers announce dynamic counters properly. Converting generic `<div className="space-y-2">` lists to semantic `<ul>`/`<li>` structures provides critical list boundary and item count context for assistive tech.
**Action:** Always use semantic list elements (`<ul>`, `<ol>`, `<li>`) for lists of items and add contextual `sr-only` text alongside `role="status"` on dynamic counters.

## 2025-02-18 - Tooltip Components vs Native Title Attributes
**Learning:** In the `swe-ui` Next.js frontend using Radix UI/shadcn Tooltip components, placing native HTML `title` attributes on a `<TooltipTrigger>` or the element inside it creates a poor UX because the browser will display the unstyled native tooltip *over* or next to the custom UI Tooltip, resulting in duplicate tooltips. Also, using native `title` on generic interactive elements like buttons is less polished than using standard custom tooltips for the app.
**Action:** When working on tooltips, never apply a native `title` to an element wrapped in a custom `<Tooltip>`. Use `aria-label` for screen reader accessibility, which does not trigger the browser's visual tooltip, leaving only the polished custom tooltip for sighted users. Upgrade native tooltips on primary actions to Radix tooltips where appropriate.
