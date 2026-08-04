1. *Modify `ThreadInput.tsx` to add a tooltip to the disabled submit button.*
   - Extract the submit `Button` into a constant.
   - Conditionally wrap the `Button` in a `Tooltip` with a `span` trigger when disabled.
   - The tooltip should explain why the button is disabled (e.g., "Please enter a task first" or "Agent is starting...").
2. *Verify the changes.*
   - Use `read_file` to ensure the syntax is correct.
   - Run `cd swe-ui && pnpm run lint` to verify code quality.
   - Run `cd swe-ui && pnpm run build` to verify the build passes.
3. *Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.*
4. *Update the Palette journal.*
   - Add a critical learning about disabled buttons and tooltips in Radix UI.
5. *Submit the change.*
   - Provide a PR description with 💡 What, 🎯 Why, 📸 Before/After, and ♿ Accessibility.
