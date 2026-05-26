## 2024-05-26 - Missing Checkbox ARIA Labels in Lists
**Learning:** Checkboxes nested in lists or custom task rows (like in `TodoSidebar.tsx`) often rely entirely on sibling text nodes for context, making them opaque to screen readers when focused directly.
**Action:** Always provide an explicit `aria-label` or `aria-labelledby` linking the state to the task description to ensure full accessibility for interactive components lacking native text wrappers.
