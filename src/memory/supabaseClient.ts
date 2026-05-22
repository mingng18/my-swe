import { Agent, fetch as undiciFetch } from "undici";
import { createLogger } from "../utils/logger";

const logger = createLogger("repo-memory");

// Keep-alive agent for Supabase connection pooling
export const supabaseAgent = new Agent({
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 60000,
  connections: 50,
});

export async function supabaseFetch(url: string | URL, init: RequestInit) {
  return undiciFetch(url, {
    ...init,
    dispatcher: supabaseAgent,
  } as any);
}

let warnedInvalidSupabaseUrl = false;
export function getSupabaseUrlBase(): string | null {
  const raw = process.env.SUPABASE_URL?.trim();
  if (!raw) return null;
  const trimmed = raw.replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`Unsupported protocol '${u.protocol}'`);
    }
    return trimmed;
  } catch (e) {
    if (!warnedInvalidSupabaseUrl) {
      warnedInvalidSupabaseUrl = true;
      logger.warn(
        { supabaseUrl: raw, err: e },
        "[repo-memory] Invalid SUPABASE_URL; disabling repo memory",
      );
    }
    return null;
  }
}

export function supabaseEnabled(): boolean {
  const url = getSupabaseUrlBase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  // Default off to avoid breaking dev/test runs without schema.
  const enabled =
    process.env.SUPABASE_REPO_MEMORY_ENABLED?.trim().toLowerCase();
  const explicitlyEnabled = enabled === "true";
  return Boolean(url && key && explicitlyEnabled);
}

export type SupabaseRow = Record<string, unknown>;

export async function supabaseSelectSingle(
  table: string,
  eq: Record<string, string>,
  select = "*",
): Promise<SupabaseRow | null> {
  const urlBase = getSupabaseUrlBase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!urlBase || !key) return null;

  const conditions = Object.entries(eq)
    .map(
      ([col, value]) =>
        `${encodeURIComponent(col)}=eq.${encodeURIComponent(value)}`,
    )
    .join("&");

  const url = `${urlBase}/rest/v1/${table}?${conditions}&select=${encodeURIComponent(select)}&limit=1`;
  const res = await supabaseFetch(url, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn(
      { table, status: res.status, body },
      "[repo-memory] supabase select failed",
    );
    return null;
  }

  const json = (await res.json()) as SupabaseRow[];
  return json?.[0] ?? null;
}

export async function supabaseUpsertSingle(
  table: string,
  row: SupabaseRow,
): Promise<SupabaseRow | null> {
  const urlBase = getSupabaseUrlBase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!urlBase || !key) return null;

  const url = `${urlBase}/rest/v1/${table}`;
  const res = await supabaseFetch(url, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([row]),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn(
      { table, status: res.status, body },
      "[repo-memory] supabase upsert failed",
    );
    return null;
  }

  const json = (await res.json()) as SupabaseRow[];
  return json?.[0] ?? null;
}

export async function supabaseRpc(
  rpcName: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const urlBase = getSupabaseUrlBase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!urlBase || !key) return false;

  const url = `${urlBase}/rest/v1/rpc/${rpcName}`;
  const res = await supabaseFetch(url, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    if (res.status !== 404) {
      const body = await res.text().catch(() => "");
      logger.warn(
        { rpcName, status: res.status, body },
        "[repo-memory] supabase rpc failed",
      );
    }
    return false;
  }

  return true;
}

export async function supabaseInsertMany(
  table: string,
  rows: SupabaseRow[],
): Promise<void> {
  const urlBase = getSupabaseUrlBase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!urlBase || !key) return;
  if (rows.length === 0) return;

  const url = `${urlBase}/rest/v1/${table}`;
  const res = await supabaseFetch(url, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn(
      { table, status: res.status, body },
      "[repo-memory] supabase insert failed",
    );
  }
}
