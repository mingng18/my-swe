// src/loop/trace-store.ts
import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import type { GoalSpec } from "./goal";
import type { VerificationResult } from "../blueprints/state";

export interface IterationRecord {
  index: number;
  agentOutput: string;
  verification: VerificationResult[];
  feedbackInjected?: string;
  decision: "retry" | "pass" | "escalate" | "hitl";
}

export type TraceOutcome = "passed" | "escalated" | "hitl_paused" | "error" | "running";

export interface TraceRecord {
  traceId: string;
  threadId: string;
  goal: GoalSpec;
  startedAt: string;
  endedAt?: string;
  iterations: IterationRecord[];
  notes: TraceNote[];
  outcome: TraceOutcome;
}

export interface TraceNote {
  at: string;
  level: "info" | "warn";
  message: string;
}

export interface TraceStore {
  open(threadId: string, goal: GoalSpec): TraceRecord;
  appendIteration(traceId: string, iter: IterationRecord): void;
  /** Append a free-form trace/feedback note (e.g. autonomy downgrades). */
  appendNote(traceId: string, note: TraceNote): void;
  finalize(traceId: string, outcome: TraceOutcome): void;
  get(traceId: string): TraceRecord | undefined;
  queryByThread(threadId: string): TraceRecord[];
  queryAll(): TraceRecord[];
}

function defaultDir(): string {
  return process.env.LOOP_TRACE_DIR ??
    join(process.env.WORKSPACE_ROOT ?? process.cwd(), "loop-traces");
}

function traceFile(dir: string, traceId: string): string {
  return join(dir, `${traceId}.jsonl`);
}

export function createTraceStore(dir: string = defaultDir()): TraceStore {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "index.sqlite"));
  db.run(
    `CREATE TABLE IF NOT EXISTS traces (
      traceId TEXT PRIMARY KEY,
      threadId TEXT,
      outcome TEXT,
      startedAt TEXT,
      endedAt TEXT,
      record TEXT
    )`,
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_thread ON traces(threadId)`);

  const live = new Map<string, TraceRecord>();
  let counter = 0;
  const newId = () =>
    `trace_${Date.now().toString(36)}_${(counter += 1)}`;

  return {
    open(threadId, goal) {
      const rec: TraceRecord = {
        traceId: newId(),
        threadId,
        goal,
        startedAt: new Date().toISOString(),
        iterations: [],
        notes: [],
        outcome: "running",
      };
      live.set(rec.traceId, rec);
      appendFileSync(
        traceFile(dir, rec.traceId),
        JSON.stringify({ event: "open", ...rec }) + "\n",
      );
      return rec;
    },
    appendIteration(traceId, iter) {
      const rec = live.get(traceId);
      if (!rec) return;
      rec.iterations.push(iter);
      appendFileSync(
        traceFile(dir, traceId),
        JSON.stringify({ event: "iteration", ...iter }) + "\n",
      );
    },
    appendNote(traceId, note) {
      const rec = live.get(traceId);
      if (!rec) return;
      rec.notes.push(note);
      appendFileSync(
        traceFile(dir, traceId),
        JSON.stringify({ event: "note", ...note }) + "\n",
      );
    },
    finalize(traceId, outcome) {
      const rec = live.get(traceId);
      if (!rec) return;
      rec.outcome = outcome;
      rec.endedAt = new Date().toISOString();
      db.run(
        `INSERT OR REPLACE INTO traces (traceId, threadId, outcome, startedAt, endedAt, record)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          rec.traceId,
          rec.threadId,
          rec.outcome,
          rec.startedAt,
          rec.endedAt ?? "",
          JSON.stringify(rec),
        ],
      );
    },
    get(traceId) {
      const row = db
        .query(`SELECT record FROM traces WHERE traceId = ?`)
        .get(traceId) as { record?: string } | undefined;
      if (row?.record) return JSON.parse(row.record) as TraceRecord;
      return live.get(traceId);
    },
    queryByThread(threadId) {
      const rows = db
        .query(`SELECT record FROM traces WHERE threadId = ? ORDER BY startedAt ASC`)
        .all(threadId) as { record: string }[];
      return rows.map((r) => JSON.parse(r.record) as TraceRecord);
    },
    queryAll() {
      const rows = db.query(`SELECT record FROM traces ORDER BY startedAt ASC`).all() as { record: string }[];
      return rows.map((r) => JSON.parse(r.record) as TraceRecord);
    },
  };
}
