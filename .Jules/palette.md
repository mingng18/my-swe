## 2023-10-25 - Contextual Actions and Hover States
**Learning:** Adding contextual actions (like copy to clipboard) inside chat bubbles using `group-hover` combined with `focus-visible` provides excellent accessibility without cluttering the UI with persistent icons. The `focus-visible` ensures keyboard users can still access the button cleanly.
**Action:** Always pair `group-hover:opacity-100` with `focus-visible:opacity-100` on interactive elements within lists or chat interfaces to maintain both a clean visual design and strict accessibility support.
