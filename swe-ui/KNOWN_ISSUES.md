# Bullhorse UI - Known Issues and Limitations

## Overview

This document outlines known issues, limitations, and future improvements for the Bullhorse UI system.

## Critical Issues

### 1. TypeScript Error in Unrelated Component

**Status:** Non-blocking

**Description:**
There is a TypeScript error in `components/ai-elements/schema-display.tsx` that prevents production builds. This component is not part of the Bullhorse UI system but exists in the same codebase.

**Error:**
```
Type 'string | number | bigint | boolean | ReactElement<...>' is not assignable to type 'string | TrustedHTML'.
Type 'number' is not assignable to type 'string | TrustedHTML'.
```

**Impact:**
- Production build fails
- Development mode works fine
- Does not affect Bullhorse UI functionality

**Fix Required:**
Update `schema-display.tsx` to properly type the `dangerouslySetInnerHTML` prop.

**Workaround:**
Use development mode for testing.

---

## Known Limitations

### 1. No Backend Event History Endpoint

**Status:** Design Limitation

**Description:**
The `/trace` endpoint returns metrics, not actual SSE events. When reconnecting to a thread, the UI cannot fetch historical events from the server.

**Current Workaround:**
- Events are stored in `sessionStorage` for history restoration
- History is lost if browser storage is cleared
- History is lost when switching to a different browser/device

**Future Improvement:**
Implement a backend endpoint that returns the complete SSE event history for a thread:

```typescript
// Proposed endpoint
GET /api/threads/:threadId/events

// Response
{
  "threadId": "abc123",
  "events": [
    { "type": "session_start", "timestamp": 1234567890 },
    { "type": "llm_start", "model": "gpt-4", "timestamp": 1234567891 },
    // ... more events
  ]
}
```

---

### 2. No Thread Persistence

**Status:** Design Limitation

**Description:**
Threads exist only in browser memory (Zustand store). Closing the browser or refreshing the page loses all thread data.

**Current Behavior:**
- Threads are stored in React state
- No backend persistence
- No database storage
- Session storage only stores events, not thread metadata

**Future Improvement:**
Implement thread persistence:
- Backend database to store thread metadata
- Local storage for offline access
- "Recent threads" list on page load
- Thread sharing via URL

---

### 3. SSE Connection Required

**Status:** Browser API Limitation

**Description:**
The UI requires `EventSource` API for SSE streaming. Some browsers or network configurations may not support SSE.

**Unsupported Scenarios:**
- Very old browsers (IE11)
- Corporate proxies that block SSE
- Some mobile browsers
- Offline mode

**Future Improvement:**
- Implement polling fallback for unsupported browsers
- Add WebSocket support as alternative
- Progressive enhancement for better browser support

---

### 4. No Authentication/Authorization

**Status:** Not Implemented

**Description:**
The UI currently has no authentication. Anyone with access to the UI can start agent runs and view all threads.

**Current Behavior:**
- No user authentication
- No thread access control
- No API key requirement (optional only)

**Future Improvement:**
- Add user authentication (OAuth, API keys)
- Add thread ownership and access control
- Add rate limiting
- Add audit logging

---

### 5. Limited Error Recovery

**Status:** Partial Implementation

**Description:**
While the UI handles connection errors gracefully, it has limited recovery from certain error scenarios.

**Scenarios:**
- Backend server restart: Handled with reconnection
- Network timeout: Handled with exponential backoff
- Backend crash: Partially handled
- Invalid thread ID: Not handled gracefully

**Future Improvement:**
- Add more robust error boundaries
- Add error recovery suggestions
- Add "safe mode" with reduced functionality
- Add error reporting/telemetry

---

## Minor Issues

### 1. Todo Close Button Not Visible

**Status:** UI Polish

**Description:**
The close button on thread tabs has `opacity-0 group-hover:opacity-100` but the parent may not have the `group` class.

**Impact:**
Close button may not appear on hover in some cases.

**Fix:**
Add `group` class to parent element or adjust CSS.

---

### 2. No Loading Skeleton for First Thread

**Status:** UX Enhancement

**Description:**
When starting the first agent run, there's a brief moment before the thread tab appears. No loading state is shown during this time.

**Impact:**
Minor UX issue, may confuse users.

**Fix:**
Add loading state to "New Run" button or show a skeleton tab.

---

### 3. Keyboard Shortcut Conflict

**Status:** Edge Case

**Description:**
⌘K (Ctrl+K) is used in many web apps for command palettes. This may conflict with browser extensions or other apps.

**Impact:**
Users may have conflicting keyboard shortcuts.

**Fix:**
Make keyboard shortcut configurable or add alternative shortcuts.

---

### 4. No Dark Mode Toggle

**Status:** Feature Request

**Description:**
The UI uses Tailwind's dark mode but has no toggle. It relies on system preferences.

**Impact:**
Users cannot manually toggle dark mode.

**Fix:**
Add dark mode toggle button with persistence.

---

### 5. Mobile Responsiveness

**Status:** Partial Implementation

**Description:**
The UI is responsive but not optimized for mobile devices.

**Issues:**
- Todo sidebar takes too much space on mobile
- Thread tabs may overflow on small screens
- Input field may be too small on mobile

**Fix:**
Add mobile-specific layout with collapsible sidebar and bottom navigation.

---

## Performance Considerations

### 1. Large Event Streams

**Status:** Monitoring Needed

**Description:**
Threads with thousands of events may cause performance issues.

**Potential Issues:**
- Timeline rendering slowdown
- Increased memory usage
- DOM size growth

**Mitigations:**
- Virtual scrolling for timeline (not implemented)
- Event pagination (not implemented)
- Automatic cleanup of old events (not implemented)

---

### 2. Memory Leaks

**Status:** Monitoring Needed

**Description:**
Long-running sessions may accumulate memory.

**Potential Sources:**
- Event listeners not cleaned up
- SSE connections not closed
- React state not cleared

**Mitigations:**
- Implement automatic thread cleanup
- Add memory monitoring
- Add thread lifecycle management

---

### 3. Reconnection Storm

**Status:** Risk

**Description:**
If many threads lose connection simultaneously, they may all try to reconnect at once, causing a "reconnection storm."

**Impact:**
- Server overload
- Network congestion
- UI freezing

**Mitigations:**
- Add jitter to reconnection delays (already implemented)
- Limit concurrent reconnections
- Add backoff coordination across threads

---

## Security Considerations

### 1. XSS Risk from Event Content

**Status:** Mitigated

**Description:**
SSE events may contain untrusted content that could be used for XSS attacks.

**Current Mitigations:**
- React escapes content by default
- No `dangerouslySetInnerHTML` in Bullhorse components
- Tool results are displayed as text/JSON

**Future Improvement:**
- Add content sanitization for tool results
- Add CSP headers
- Add input validation on backend

---

### 2. CSRF Risk

**Status:** Mitigated

**Description:**
Malicious sites could make requests to the Bullhorse API.

**Current Mitigations:**
- API is typically localhost only
- No authentication to compromise

**Future Improvement:**
- Add CSRF tokens
- Add origin checking
- Add SameSite cookie flags

---

### 3. SSE Hijacking

**Status:** Low Risk

**Description:**
If authentication is added, SSE connections could be hijacked.

**Current Mitigations:**
- No authentication yet
- Short-lived connections

**Future Improvement:**
- Add token-based SSE authentication
- Add connection signing
- Add IP-based restrictions

---

## Testing Gaps

### 1. No Automated E2E Tests

**Status:** Not Implemented

**Description:**
There are no automated end-to-end tests for the UI.

**Impact:**
- Manual testing required
- Regressions may go undetected
- Slower development cycle

**Future Improvement:**
- Add Playwright or Cypress tests
- Add Visual Regression tests
- Add Accessibility tests

---

### 2. No Unit Tests for Components

**Status:** Not Implemented

**Description:**
Components are not unit tested.

**Impact:**
- Refactoring is risky
- Bugs may be introduced
- Hard to verify edge cases

**Future Improvement:**
- Add Jest + React Testing Library
- Test component rendering
- Test user interactions
- Test error states

---

### 3. No Integration Tests

**Status:** Not Implemented

**Description:**
There are no integration tests for the SSE client and state management.

**Impact:**
- Hard to verify complex interactions
- Edge cases may be missed
- Refactoring is risky

**Future Improvement:**
- Add integration tests for SSE client
- Add tests for state management
- Add tests for event adapters

---

## Documentation Gaps

### 1. API Documentation

**Status:** Incomplete

**Description:**
The SSE event types and formats are not fully documented.

**Impact:**
- Hard for contributors to understand events
- Risk of breaking changes
- Hard to integrate with other tools

**Future Improvement:**
- Add OpenAPI/Swagger spec
- Add event catalog
- Add integration guide

---

### 2. Component Documentation

**Status:** Basic

**Description:**
Components have basic JSDoc but no comprehensive documentation.

**Impact:**
- Hard for new contributors
- Props and behaviors not fully documented
- Examples missing

**Future Improvement:**
- Add Storybook for components
- Add usage examples
- Add prop documentation

---

## Future Enhancements

### High Priority

1. **Fix TypeScript Error:** Unblocking production builds
2. **Add Backend Event History:** Enable proper history restoration
3. **Add Thread Persistence:** Survive page refreshes
4. **Add Authentication:** Secure the UI

### Medium Priority

5. **Add Mobile Optimization:** Better mobile experience
6. **Add Dark Mode Toggle:** User preference control
7. **Add Error Boundaries:** Better error handling
8. **Add Automated Tests:** Regression prevention

### Low Priority

9. **Add Virtual Scrolling:** Handle large event streams
10. **Add Thread Sharing:** Share threads via URL
11. **Add Export/Import:** Save thread data locally
12. **Add Analytics:** Usage tracking and insights

---

## Conclusion

This document outlines all known issues and limitations. Most are design decisions or future enhancements rather than critical bugs. The system is functional for its intended use case but has room for improvement.

For questions or to report new issues, please refer to the main project repository.
