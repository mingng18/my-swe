🎯 **What:** Added unit tests for the `sendCommandReply` function to cover telegram reply logic, formatting routing, and plain-text fallbacks.
📊 **Coverage:** Covered successful MarkdownV2 formatting, fallback to plain text upon HTTP errors (like 400), correct request payload assertions, and ensuring network errors are properly caught without crashing the dispatch loop.
✨ **Result:** Increased test coverage for index.ts dispatch logic, assuring Telegram edge cases and fallbacks function safely and predictably.
