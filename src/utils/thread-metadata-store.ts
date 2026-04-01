import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface PersistedThreadRepo {
  owner: string;
  name: string;
  workspaceDir: string;
  sandbox?: {
    sandboxId: string;
    profile: string;
  };
  updatedAt: string;
}

interface PersistedThreadMetadata {
  repos: Record<string, PersistedThreadRepo>;
}

const STORE_PATH =
  process.env.THREAD_METADATA_PATH?.trim() || ".cursor/state/thread-metadata.json";
const MAX_AGE_MS =
  Number.parseInt(process.env.THREAD_METADATA_TTL_MS || "", 10) ||
  1000 * 60 * 60 * 24 * 7;

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

async function readStore(): Promise<PersistedThreadMetadata> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as PersistedThreadMetadata;
    return parsed?.repos ? parsed : { repos: {} };
  } catch {
    return { repos: {} };
  }
}

async function writeStore(data: PersistedThreadMetadata): Promise<void> {
  await ensureDir(STORE_PATH);
  await writeFile(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function loadPersistedThreadRepos(): Promise<
  Map<string, { owner: string; name: string; workspaceDir: string }>
> {
  const store = await readStore();
  const now = Date.now();
  const result = new Map<string, { owner: string; name: string; workspaceDir: string }>();
  let changed = false;

  for (const [threadId, value] of Object.entries(store.repos)) {
    const updatedAt = Date.parse(value.updatedAt);
    if (!Number.isFinite(updatedAt) || now - updatedAt > MAX_AGE_MS) {
      delete store.repos[threadId];
      changed = true;
      continue;
    }
    result.set(threadId, {
      owner: value.owner,
      name: value.name,
      workspaceDir: value.workspaceDir,
    });
  }

  if (changed) {
    await writeStore(store);
  }

  return result;
}

export async function persistThreadRepo(
  threadId: string,
  repo: {
    owner: string;
    name: string;
    workspaceDir: string;
    sandbox?: { sandboxId: string; profile: string };
  },
): Promise<void> {
  const store = await readStore();
  store.repos[threadId] = {
    ...repo,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
}

export async function removePersistedThreadRepo(threadId: string): Promise<void> {
  const store = await readStore();
  if (store.repos[threadId]) {
    delete store.repos[threadId];
    await writeStore(store);
  }
}
