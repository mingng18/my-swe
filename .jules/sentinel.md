## 2024-05-26 - XSS Risk in UI Schema Display
**Vulnerability:** The `SchemaDisplayPath` component used `dangerouslySetInnerHTML` to render a regex-replaced string containing HTML spanning tags to highlight path parameters.
**Learning:** Using `dangerouslySetInnerHTML` with dynamically split and re-assembled strings (even with simple regex replacement) is risky and a violation of React best practices, as it bypasses React's built-in XSS protection and makes the code brittle when rendering `children` nodes.
**Prevention:** Avoid `dangerouslySetInnerHTML` in React components. Instead, parse dynamic strings into arrays and map them natively to safe React elements, such as wrapping matching substrings in `<span>` tags.
