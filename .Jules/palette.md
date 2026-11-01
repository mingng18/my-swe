## 2024-08-18 - Tooltips on Icon-Only Buttons
**Learning:** When adding tooltips in UI frameworks like Radix/shadcn, avoid using native HTML \`title\` attributes on interactive elements, especially icon-only buttons, as they create duplicate, unstyled tooltips with a delay.
**Action:** Instead, use an \`aria-label\` for screen readers and wrap the element in a custom UI \`<Tooltip>\` component.
