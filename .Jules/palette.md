## 2024-07-14 - Animated Chevron for Details Element
**Learning:** Native `<details>` and `<summary>` elements in this design system can be drastically improved by hiding the default webkit marker (`[&::-webkit-details-marker]:hidden`), adding a custom SVG icon (like `ChevronRight`), and applying a rotational transition class (`group-open/details:rotate-90`) when the `details` state opens. Adding proper `focus-visible` styles ensures strong keyboard accessibility for these interactive elements.
**Action:** Always prefer restyling native `<details>` elements with standard icons and focus rings rather than relying on the default browser styles, especially in data-heavy components like timelines where users frequently toggle views.
## 2024-07-14 - Animated Chevron for Details Element
**Learning:** Native `<details>` and `<summary>` elements in this design system can be drastically improved by hiding the default webkit marker (`[&::-webkit-details-marker]:hidden`), adding a custom SVG icon (like `ChevronRight`), and applying a rotational transition class (`group-open/details:rotate-90`) when the `details` state opens. Adding proper `focus-visible` styles ensures strong keyboard accessibility for these interactive elements.
**Action:** Always prefer restyling native `<details>` elements with standard icons and focus rings rather than relying on the default browser styles, especially in data-heavy components like timelines where users frequently toggle views.
## 2025-02-28 - Auto-scroll for Live Event Timelines
**Learning:** When displaying a streaming list of events or messages (like an LLM agent timeline), failing to auto-scroll to the bottom forces users to manually scroll to see updates. This is a common pattern that is easy to fix.
**Action:** Use a standard `useRef` targeting an empty `div` at the bottom of the list, and trigger `scrollIntoView({ behavior: 'smooth' })` within a `useEffect` that depends on the list contents.
## 2024-07-17 - Fix Focus Restoration on Unmounting Elements
**Learning:** When interacting with an element that immediately unmounts (e.g. a "Clear Input" button that disappears when the input is empty), keyboard focus will naturally be lost, resetting it to the body. Using `ref.current.focus()` inside the click handler is necessary to programmatically restore focus to the input.
**Action:** In interactive forms with conditional buttons (like a clear button), always manually redirect focus to a relevant stable element (like the input field) before or immediately after the button unmounts.
## 2024-05-18 - Avoid Package Modifications

**Learning:** When improving UI/UX as Palette, simply running `bun` or `pnpm` install commands can inadvertently mutate `package.json` with mismatched or hallucinated versions, breaking the build.
**Action:** Always run `git status` after verifying frontend UI to check if lockfiles or `package.json` were accidentally modified, and run `git restore` on them before creating a PR.
## 2024-07-16 - Handling Focus Restoration for Unmounting Elements
**Learning:** In React, when a UI element like a 'Clear input' button is clicked and unmounts immediately (e.g., because the input text was cleared and the button is conditionally rendered), the browser's focus will often be lost to the `body` element before standard `onClick` focus logic can complete, especially if the `onClick` handler executes synchronously.
**Action:** When restoring focus after a clearing action that causes the trigger element to unmount, wrap the `.focus()` call in a `setTimeout(..., 0)` to ensure it executes in the next event loop tick, after React has completed its render cycle and the DOM has settled.
## 2024-07-16 - Handle Playwright click interception
**Learning:** Playwright `click()` can be intercepted by an element that overlaps the button, even if visually the button appears to be on top.
**Action:** Use `.dispatchEvent('click')` as an alternative to trigger the click in Playwright tests.
