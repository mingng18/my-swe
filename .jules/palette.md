## 2025-06-20 - Ensure icon buttons have both aria-label and title
**Learning:** React components that use Radix/shadcn tooltips often still need native `title` attributes for robust, immediate hover feedback across various interaction modes, and pairing `title` with `aria-label` ensures standard and assistive technology alignment.
**Action:** When adding accessible labels to icon-only buttons, pair `aria-label` and `title` to provide comprehensive support without requiring complex Tooltip wrappers.
