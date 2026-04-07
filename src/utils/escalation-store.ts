import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { RetryAttempt } from "../blueprints/retry-loop";
import { createLogger } from "./logger";

const logger = createLogger("escalation-store");

export interface EscalationRecord {
  id: string;
  nodeId: string;
  attempts: RetryAttempt[];
  lastError: string;
  timestamp: string;
}

interface PersistedEscalations {
  records: EscalationRecord[];
}

function getStorePath(): string {
  return (
    process.env.ESCALATION_STORE_PATH?.trim() ||
    ".cursor/state/escalations.json"
  );
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

async function readStore(): Promise<PersistedEscalations> {
  const storePath = getStorePath();
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedEscalations;
    return parsed?.records ? parsed : { records: [] };
  } catch {
    return { records: [] };
  }
}

async function writeStore(data: PersistedEscalations): Promise<void> {
  const storePath = getStorePath();
  await ensureDir(storePath);
  await writeFile(storePath, JSON.stringify(data, null, 2), "utf8");
}

export async function storeEscalation(
  nodeId: string,
  attempts: RetryAttempt[],
  lastError: string,
): Promise<string> {
  try {
    const store = await readStore();
    const id = randomUUID();
    const record: EscalationRecord = {
      id,
      nodeId,
      attempts,
      lastError,
      timestamp: new Date().toISOString(),
    };

    store.records.push(record);
    await writeStore(store);

    logger.debug({ escalationId: id, nodeId }, "Stored escalation record");
    return id;
  } catch (error) {
    logger.error({ error, nodeId }, "Failed to store escalation record");
    throw error;
  }
}

export async function getEscalations(): Promise<EscalationRecord[]> {
  const store = await readStore();
  return store.records;
}
