## 2026-07-19 - Added ARIA attributes to Agent Thread Monitor
**Learning:** For continuous live-updating chat logs or event streams (like ThreadTimeline), adding `role="log"` and `aria-live="polite"` automatically notifies screen readers of incoming messages without requiring manual user navigation, massively improving accessibility. Similarly, wrapping status indicators (like connection state in ThreadHeader) with `role="status" aria-live="polite"` is crucial for conveying realtime system states.
**Action:** Always wrap dynamic lists of messages, feeds, and critical status indicators with appropriate ARIA live regions so assistive tech can gracefully announce state changes as they happen.
## 2026-07-22 - Added keyboard focus to scrollable code blocks
**Learning:** Horizontally scrolling code blocks or JSON payloads (like `<pre>` tags) must have `tabIndex={0}` and proper `focus-visible` styles so that keyboard-only users can focus them and scroll their contents using arrow keys. Without this, hidden content in overflowing containers becomes inaccessible.
**Action:** Always add `tabIndex={0}` and an `aria-label` along with standard focus ring utility classes to any scrollable container (especially `<pre>` or `<div>` with `overflow-x-auto`) to ensure keyboard accessibility.

## 2023-10-25 - Contextual Actions and Hover States
**Learning:** Adding contextual actions (like copy to clipboard) inside chat bubbles using `group-hover` combined with `focus-visible` provides excellent accessibility without cluttering the UI with persistent icons. The `focus-visible` ensures keyboard users can still access the button cleanly.
**Action:** Always pair `group-hover:opacity-100` with `focus-visible:opacity-100` on interactive elements within lists or chat interfaces to maintain both a clean visual design and strict accessibility support.
