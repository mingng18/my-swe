// src/loop/state-store.ts
import { mkdirSync, existsSync, unlinkSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { GoalSpec } from "./goal";

export interface LoopState {
  threadId: string;
  goal: GoalSpec;
  iteration: number;
  done: string[];
  next: string[];
  tried: string[];
  lastError?: string;
  hitl?: { requestId: string; reason: string; pendingAction: string };
  traceId: string;
  updatedAt: string;
}

export interface StateStore {
  load(threadId: string): Promise<LoopState | undefined>;
  save(state: LoopState): Promise<void>;
  clear(threadId: string): void;
}

function defaultDir(): string {
  return process.env.LOOP_STATE_DIR ??
    join(process.env.WORKSPACE_ROOT ?? process.cwd(), "loop-state");
}

function file(dir: string, threadId: string): string {
  return join(dir, `${threadId}.json`);
}

export function createStateStore(dir: string = defaultDir()): StateStore {
  mkdirSync(dir, { recursive: true });
  return {
    async load(threadId) {
      const f = file(dir, threadId);
      if (!existsSync(f)) return undefined;
      const data = await readFile(f, "utf-8");
      return JSON.parse(data) as LoopState;
    },
    async save(state) {
      await writeFile(
        file(dir, state.threadId),
        JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
      );
    },
    clear(threadId) {
      const f = file(dir, threadId);
      if (existsSync(f)) unlinkSync(f);
    },
  };
}
