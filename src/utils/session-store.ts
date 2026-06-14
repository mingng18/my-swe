/**
 * Per-thread session state for user-facing command features (#498 family).
 *
 * Holds Bullhorse-level per-thread overrides that the harness reads at turn
 * time — currently `mode` (Plan/Act) and `modelOverride` (/model). The harness
 * itself persists conversation history in its own checkpointer; this store is
 * only for these lightweight per-thread controls.
 *
 * Bounded: entries TTL out (default 1h) and the map is capped, so a long-lived
 * server can't grow it without limit. `purgeStaleSessions` is exported so the
 * thread-cleanup-scheduler can drive deterministic eviction.
 */

export type AgentMode = "plan" | "act";

interface SessionState {
  mode: AgentMode;
  modelOverride?: string;
  lastAccessed: number;
}

const DEFAULT_TTL_MS = Number.parseInt(
  process.env.SESSION_STORE_TTL_MS || "3600000",
  10,
); // 1h
const DEFAULT_MAX_THREADS = Number.parseInt(
  process.env.SESSION_STORE_MAX_THREADS || "10000",
  10,
);

const store = new Map<string, SessionState>();

function touch(state: SessionState): SessionState {
  state.lastAccessed = Date.now();
  return state;
}

function getOrCreate(threadId: string): SessionState {
  let state = store.get(threadId);
  if (!state) {
    state = { mode: "act", lastAccessed: Date.now() };
    store.set(threadId, state);
    enforceCap();
  }
  return state;
}

function enforceCap(): void {
  if (store.size <= DEFAULT_MAX_THREADS) return;
  // Evict the least-recently-accessed entries until under cap.
  const entries = [...store.entries()].sort(
    (a, b) => a[1].lastAccessed - b[1].lastAccessed,
  );
  const excess = store.size - DEFAULT_MAX_THREADS;
  for (let i = 0; i < excess; i++) {
    store.delete(entries[i][0]);
  }
}

/** Current mode for a thread; defaults to "act" (today's behavior). */
export function getMode(threadId: string): AgentMode {
  const state = store.get(threadId);
  if (!state) return "act";
  touch(state);
  return state.mode;
}

export function setMode(threadId: string, mode: AgentMode): void {
  touch(getOrCreate(threadId)).mode = mode;
}

/** Per-thread model override (/model); undefined = use the global MODEL. */
export function getModelOverride(threadId: string): string | undefined {
  const state = store.get(threadId);
  if (!state) return undefined;
  touch(state);
  return state.modelOverride;
}

export function setModelOverride(threadId: string, model: string | undefined): void {
  touch(getOrCreate(threadId)).modelOverride = model;
}

export function clearSession(threadId: string): void {
  store.delete(threadId);
}

export function getSessionSize(): number {
  return store.size;
}

/** Evict entries older than `ttlMs` (default from SESSION_STORE_TTL_MS). */
export function purgeStaleSessions(
  now: number = Date.now(),
  ttlMs: number = DEFAULT_TTL_MS,
): number {
  let removed = 0;
  for (const [id, state] of store) {
    if (now - state.lastAccessed > ttlMs) {
      store.delete(id);
      removed++;
    }
  }
  return removed;
}
