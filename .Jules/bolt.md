## 2026-09-20 - [Zustand Event Stream Performance]
**Learning:** Subscribing to full state objects in hooks that handle fast streaming events causes massive re-render overhead. Using getState() in callbacks prevents cascading re-renders.
**Action:** Select individual actions from Zustand and use getState() to fetch state on-demand inside callbacks.
