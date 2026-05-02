# Bullhorse UI - End-to-End Testing Documentation

## Overview

This document provides comprehensive testing guidelines for the Bullhorse UI system. Since the UI relies on server-side SSE streaming, testing requires both manual verification and automated checks.

## Test Environment Setup

### Prerequisites

1. **Backend Server Running:**
   ```bash
   # In the bullhorse repository
   bun run dev
   ```
   Server should be running on `http://localhost:7860`

2. **UI Development Server:**
   ```bash
   # In the swe-ui directory
   bun run dev
   ```
   UI should be running on `http://localhost:3000`

3. **Environment Configuration:**
   ```bash
   # In swe-ui/.env.local
   NEXT_PUBLIC_BULLHORSE_API_URL=http://localhost:7860
   ```

## Test Scenarios

### 1. Initial Load Test

**Objective:** Verify the UI loads correctly with no active threads.

**Steps:**
1. Open `http://localhost:3000` in a browser
2. Verify the page loads without errors
3. Check browser console for no errors or warnings

**Expected Results:**
- ✅ Header displays "Bullhorse Agent Monitor" with bot icon
- ✅ Connection status shows "Disconnected" (gray indicator)
- ✅ "No active threads" message is visible in tabs area
- ✅ Empty state card is displayed with example tasks
- ✅ Input field is visible and focused
- ✅ "Start Agent" button is disabled (empty input)
- ✅ Keyboard shortcut hint displays "⌘K"

**Verification Commands:**
```bash
# Check for TypeScript errors
bunx tsc --noEmit

# Check for linting errors
bun run lint
```

### 2. Start New Agent Run Test

**Objective:** Verify starting a new agent run creates a thread and connects to SSE stream.

**Steps:**
1. Enter a task in the input field (e.g., "Find auth implementations")
2. Click "Start Agent" button
3. Monitor the UI for state changes

**Expected Results:**
- ✅ Button shows loading state with spinner
- ✅ New thread tab appears with short thread ID
- ✅ Thread status shows "running" (blue pulsing indicator)
- ✅ Connection status changes to "Connecting..." (yellow)
- ✅ Connection status changes to "Connected" (green pulsing)
- ✅ Timeline shows events as they stream in
- ✅ Todo sidebar appears and updates with tasks
- ✅ Input field clears and is ready for new input

**SSE Events to Verify:**
- `session_start` - Thread initialization
- `llm_start` - LLM thinking starts
- `llm_chunk` - Streaming response chunks
- `tool_call` - Tool invocations
- `tool_result` - Tool results
- `todo_added` - Task creation
- `todo_updated` - Task status updates
- `session_end` - Thread completion

### 3. Multiple Concurrent Threads Test

**Objective:** Verify the system handles multiple threads correctly.

**Steps:**
1. Start first agent run with task "Find auth implementations"
2. Wait for thread to be created
3. Start second agent run with task "Fix login bug"
4. Wait for second thread to be created
5. Switch between threads using tabs
6. Verify each thread maintains its own state

**Expected Results:**
- ✅ Two thread tabs appear with different IDs
- ✅ Each tab shows correct status icon (running/completed/error)
- ✅ Clicking a tab switches the active thread
- ✅ Timeline updates to show selected thread's events
- ✅ Todo sidebar updates to show selected thread's todos
- ✅ Each thread maintains its own connection state
- ✅ Input field works for starting new runs from any thread

**State Verification:**
- Thread 1: Events and todos are distinct from Thread 2
- Thread 2: Events and todos are distinct from Thread 1
- Active thread: Highlighted in tabs
- Inactive threads: Maintained in background

### 4. Connection Drop and Reconnect Test

**Objective:** Verify SSE connection handles network interruptions gracefully.

**Steps:**
1. Start an agent run
2. Wait for connection to establish
3. Simulate connection drop (restart backend server)
4. Observe reconnection behavior

**Expected Results:**
- ✅ Reconnection banner appears with "Connection Lost" message
- ✅ Banner shows reconnection attempt count
- ✅ "Reconnect Now" button is available
- ✅ Connection status shows "Connection Error" (red)
- ✅ When connection restores: "Reconnected" toast appears
- ✅ Events continue streaming after reconnection
- ✅ Session storage restores event history

**Manual Reconnection Test:**
1. Click "Reconnect Now" button
2. Verify connection status changes to "Connecting..."
3. Verify connection status changes to "Connected"
4. Verify "Reconnected" toast appears

### 5. Error Handling Test

**Objective:** Verify error states are handled correctly.

**Test Cases:**

**A. Server Not Running:**
1. Stop backend server
2. Try to start agent run
3. Expected: Error banner with "Failed to start agent" message

**B. Invalid Thread ID:**
1. Manually navigate to `?threadId=invalid`
2. Expected: Error banner or graceful handling

**C. SSE Stream Error:**
1. Start agent run
2. Backend returns error event
3. Expected: Error banner appears with error message
4. Expected: Thread status changes to "error"
5. Expected: "Retry" button is available

**D. Network Timeout:**
1. Slow/intermittent network connection
2. Expected: Reconnection attempts with exponential backoff
3. Expected: Max retries reached after ~10 attempts

### 6. UI Component Integration Test

**Objective:** Verify all UI components work together correctly.

**Components to Verify:**

**A. ThreadMonitor (Main Component):**
- ✅ Header with title and connection status
- ✅ Thread tabs integration
- ✅ Todo sidebar integration
- ✅ Timeline/event display
- ✅ Input field for new runs
- ✅ Error banners
- ✅ Reconnection banners
- ✅ Loading states

**B. ThreadTabs:**
- ✅ Displays all active threads
- ✅ Shows status icons (running/completed/error)
- ✅ Allows switching between threads
- ✅ Close button removes threads
- ✅ "New Run" button works

**C. TodoSidebar:**
- ✅ Displays thread todos
- ✅ Shows completion progress
- ✅ Status badges (pending/in_progress/completed)
- ✅ Visual distinction for different statuses
- ✅ Empty state when no todos

**D. Toast Notifications:**
- ✅ Reconnected toast appears
- ✅ Toast auto-dismisses after 3 seconds
- ✅ Manual dismiss works
- ✅ Multiple toasts stack correctly

### 7. Keyboard Shortcuts Test

**Objective:** Verify keyboard shortcuts work correctly.

**Test Cases:**
- ⌘K (Ctrl+K on Windows/Linux): Focus input field
- Enter in input: Start agent run
- Shift+Enter: Insert newline (don't submit)

**Expected Results:**
- ✅ Keyboard shortcut focuses input field
- ✅ Enter submits when input has text
- ✅ Enter doesn't submit when input is empty
- ✅ Shift+Enter allows multiline input

### 8. Responsive Design Test

**Objective:** Verify UI works on different screen sizes.

**Screen Sizes to Test:**
- Desktop: 1920x1080
- Laptop: 1366x768
- Tablet: 768x1024
- Mobile: 375x667

**Expected Results:**
- ✅ Layout adapts to screen size
- ✅ Sidebar collapses or adjusts on mobile
- ✅ Input field remains usable
- ✅ Tabs scroll if too many threads
- ✅ Timeline remains readable
- ✅ No horizontal scrolling

### 9. Performance Test

**Objective:** Verify UI performance under load.

**Test Cases:**

**A. Large Event Stream:**
1. Start agent run that generates many events
2. Monitor timeline rendering performance
3. Expected: Smooth scrolling, no lag

**B. Many Concurrent Threads:**
1. Start 5+ concurrent agent runs
2. Monitor UI responsiveness
3. Expected: All tabs update correctly

**C. Long-Running Thread:**
1. Start a long-running agent task
2. Monitor memory usage
3. Expected: No memory leaks

**Performance Metrics:**
- Timeline rendering: < 100ms per event
- State updates: < 50ms
- Reconnection time: < 5 seconds

### 10. Browser Compatibility Test

**Browsers to Test:**
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile Safari (iOS)
- Chrome Mobile (Android)

**Expected Results:**
- ✅ All features work across browsers
- ✅ SSE connection works
- ✅ EventSource API supported
- ✅ CSS renders correctly
- ✅ Keyboard shortcuts work

## Automated Testing

### TypeScript Compilation

```bash
# Verify no TypeScript errors
bunx tsc --noEmit
```

### Build Test

```bash
# Verify production build works
bun run build
```

### Lint Test

```bash
# Verify code quality
bun run lint
```

## Known Limitations

### 1. Backend Dependency
- UI cannot function without backend server
- SSE streaming requires real backend connection
- Mock SSE events for unit testing needed

### 2. Event History
- `/trace` endpoint returns metrics, not actual events
- Event history relies on session storage
- History lost on browser refresh/storage clear

### 3. Thread Persistence
- Threads exist only in browser memory
- Closing browser loses all threads
- No backend persistence implemented

### 4. Real-time Updates
- SSE connection required for live updates
- No polling fallback for unsupported browsers
- EventSource API limitations in some environments

## Debugging Tips

### Enable SSE Logging

```typescript
// In browser console
localStorage.setItem('debug', 'sse:*')
```

### Monitor Network Tab

1. Open Browser DevTools (F12)
2. Go to Network tab
3. Filter by "EventStream"
4. Verify SSE messages are received

### Check State Management

```typescript
// In browser console
// Access Zustand store
const store = window.__THREAD_STORE__
console.log(store.getState())
```

### Verify Session Storage

```typescript
// In browser console
// Check stored events
const threadId = 'your-thread-id'
const events = JSON.parse(sessionStorage.getItem(`bullhorse_events_${threadId}`))
console.log(events)
```

## Test Checklist

Use this checklist for comprehensive testing:

- [ ] Initial load displays correctly
- [ ] Start agent run works
- [ ] SSE connection establishes
- [ ] Events stream in real-time
- [ ] Timeline updates correctly
- [ ] Todo sidebar updates
- [ ] Thread tabs work
- [ ] Multiple threads work
- [ ] Connection drop handles gracefully
- [ ] Reconnection works
- [ ] Error states display correctly
- [ ] Keyboard shortcuts work
- [ ] Responsive design works
- [ ] Performance is acceptable
- [ ] Browser compatibility verified
- [ ] TypeScript compilation passes
- [ ] Build succeeds
- [ ] No console errors

## Reporting Issues

When reporting issues, include:

1. **Browser and Version:** Chrome 120, Firefox 115, etc.
2. **OS:** macOS 14, Windows 11, etc.
3. **Steps to Reproduce:** Detailed step-by-step
4. **Expected Behavior:** What should happen
5. **Actual Behavior:** What actually happened
6. **Console Errors:** Any errors in browser console
7. **Network Logs:** SSE connection status from Network tab

## Conclusion

This testing documentation provides comprehensive coverage of the Bullhorse UI system. Follow these scenarios to verify the entire system works correctly from end-to-end.
