import { randomUUID, createHash } from "node:crypto";
import { createLogger } from "../utils/logger";
import {
  getSandboxProfileFromEnv,
  extractRepoFromInput,
} from "../utils/config";
import {
  supabaseEnabled,
  getSupabaseUrlBase,
  supabaseSelectSingle,
  supabaseUpsertSingle,
  supabaseRpc,
  supabaseInsertMany,
  supabaseFetch,
} from "./supabaseClient";

const logger = createLogger("repo-memory");

export interface RepoMemoryTurnResult {
  threadId: string;
  userText: string;
  input: string;
  agentReply: string | undefined;
  fullTurnOutput: string;
  agentError: string | undefined;
  plan?: string;
  fixAttempt?: string;
  iterations?: number;
  deterministic: {
    formatResults?: {
      success: boolean;
      filesChanged?: number;
      output?: string;
    };
    linterResults?: { success: boolean; exitCode?: number; output?: string };
    linterError?: string | undefined;
    validationResults?: {
      passed: boolean;
      checks?: Record<string, boolean | undefined>;
      output?: string;
    };
    testResults?: { passed: boolean; summary?: string; output?: string };
  };
}

function truncateForJson(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…(truncated)`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Best-effort persistence of repo/run metadata into Supabase.
 *
 * Important:
 * - This is intentionally non-fatal: failures should not break the agent pipeline.
 * - It assumes tables/columns roughly match the proposed plan in `.cursor/plans/...`.
 */
export async function writeRepoMemoryAfterAgentTurn(
  turn: RepoMemoryTurnResult,
): Promise<void> {
  if (!supabaseEnabled()) return;

  const urlBase = getSupabaseUrlBase();
  if (!urlBase) return;

  const parsedRepo = extractRepoFromInput(turn.input);
  const profile = getSandboxProfileFromEnv();
  if (!parsedRepo) {
    logger.debug(
      "[repo-memory] No --repo found in input; skipping repo memory",
    );
    return;
  }

  const startedAtIso = new Date().toISOString();
  const inputHash = sha256(turn.input);
  const replyHash = sha256(turn.agentReply || "");

  try {
    const repoId = randomUUID();
    const agentRunId = randomUUID();

    const factRows = [
      {
        id: randomUUID(),
        fact_type: "turn",
        fact_key: "summary",
        value_json: {
          input_hash: inputHash,
          reply_hash: replyHash,
          iterations: turn.iterations || 0,
          plan_present: Boolean(turn.plan),
          fix_attempt_present: Boolean(turn.fixAttempt),
          reply_length: (turn.agentReply || "").length,
          full_output_length: turn.fullTurnOutput.length,
        },
        created_at: startedAtIso,
      },
      {
        id: randomUUID(),
        fact_type: "deterministic",
        fact_key: "linter",
        value_json: {
          success: turn.deterministic.linterResults?.success ?? false,
          exitCode: turn.deterministic.linterResults?.exitCode ?? null,
          error:
            truncateForJson(turn.deterministic.linterError || "", 10_000) ||
            null,
          output:
            truncateForJson(
              turn.deterministic.linterResults?.output || "",
              20_000,
            ) || null,
        },
        created_at: startedAtIso,
      },
      {
        id: randomUUID(),
        fact_type: "deterministic",
        fact_key: "format",
        value_json: {
          success: turn.deterministic.formatResults?.success ?? true,
          filesChanged: turn.deterministic.formatResults?.filesChanged ?? null,
          output:
            truncateForJson(
              turn.deterministic.formatResults?.output || "",
              20_000,
            ) || null,
        },
        created_at: startedAtIso,
      },
      {
        id: randomUUID(),
        fact_type: "deterministic",
        fact_key: "validation",
        value_json: {
          passed: turn.deterministic.validationResults?.passed ?? false,
          checks: turn.deterministic.validationResults?.checks ?? {},
          output:
            truncateForJson(
              turn.deterministic.validationResults?.output || "",
              20_000,
            ) || null,
        },
        created_at: startedAtIso,
      },
      {
        id: randomUUID(),
        fact_type: "deterministic",
        fact_key: "tests",
        value_json: {
          passed: turn.deterministic.testResults?.passed ?? false,
          summary: turn.deterministic.testResults?.summary ?? null,
          output:
            truncateForJson(
              turn.deterministic.testResults?.output || "",
              20_000,
            ) || null,
        },
        created_at: startedAtIso,
      },
    ];

    let chunkRows: Record<string, any>[] | null = null;
    const vectorEnabled =
      process.env.SUPABASE_REPO_MEMORY_VECTOR_CHUNKS?.trim().toLowerCase() ===
      "true";
    if (vectorEnabled) {
      const chunkText = turn.agentReply
        ? truncateForJson(turn.agentReply, 16_000)
        : "";
      chunkRows = [
        {
          id: randomUUID(),
          chunk_type: "assistant_reply",
          content_text: chunkText,
          content_hash: sha256(chunkText),
          created_at: startedAtIso,
        },
      ];
    }

    // Try RPC first for N+1 optimization
    const rpcSuccess = await supabaseRpc("record_agent_turn", {
      p_repo_id: repoId,
      p_owner: parsedRepo.owner,
      p_name: parsedRepo.name,
      p_thread_id: turn.threadId,
      p_workspace_dir: parsedRepo.workspaceDir,
      p_profile: profile,
      p_agent_run_id: agentRunId,
      p_input_hash: inputHash,
      p_reply_hash: replyHash,
      p_status: turn.agentError ? "error" : "success",
      p_error: turn.agentError || null,
      p_started_at: startedAtIso,
      p_finished_at: startedAtIso,
      p_facts: factRows,
      p_chunks: chunkRows,
    });

    if (rpcSuccess) {
      logger.info(
        {
          threadId: turn.threadId,
          repo: `${parsedRepo.owner}/${parsedRepo.name}`,
        },
        "[repo-memory] Persisted repo memory after turn via RPC",
      );
      return;
    }

    // Fallback to sequential network requests if RPC fails (e.g. migration not applied yet)
    logger.debug(
      "[repo-memory] RPC failed (404?), falling back to sequential inserts",
    );

    // 1) Repo upsert → repo_id
    const existingRepo = await supabaseSelectSingle(
      "repo",
      { owner: parsedRepo.owner, name: parsedRepo.name },
      "id",
    );
    const repoRow =
      existingRepo ??
      (await supabaseUpsertSingle("repo", {
        id: randomUUID(),
        owner: parsedRepo.owner,
        name: parsedRepo.name,
        created_at: startedAtIso,
      }));

    const resolvedRepoId = repoRow?.id;
    if (!resolvedRepoId || typeof resolvedRepoId !== "string") {
      logger.warn(
        { repoRow },
        "[repo-memory] Could not determine repo_id; aborting memory write",
      );
      return;
    }

    // 2) Thread repo context upsert
    await supabaseUpsertSingle("thread_repo_context", {
      thread_id: turn.threadId,
      repo_id: resolvedRepoId,
      workspace_dir: parsedRepo.workspaceDir,
      profile,
      updated_at: startedAtIso,
    });

    // 3) Agent run select/insert by (thread_id, input_hash) unique key
    const existingRun = await supabaseSelectSingle(
      "agent_run",
      { thread_id: turn.threadId, input_hash: inputHash },
      "id,status",
    );

    let resolvedAgentRunId: string;
    if (existingRun?.id && typeof existingRun.id === "string") {
      resolvedAgentRunId = existingRun.id;
      // Update status/finished timestamps. If columns don't exist, this will be ignored.
      await supabaseFetch(
        `${urlBase}/rest/v1/agent_run?id=eq.${encodeURIComponent(resolvedAgentRunId)}`,
        {
          method: "PATCH",
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            status: turn.agentError ? "error" : "success",
            error: turn.agentError || null,
            reply_hash: replyHash,
            finished_at: startedAtIso,
          }),
        },
      ).catch((e) =>
        logger.warn({ e }, "[repo-memory] supabase agent_run patch failed"),
      );
    } else {
      resolvedAgentRunId = randomUUID();
      const inserted = await supabaseUpsertSingle("agent_run", {
        id: resolvedAgentRunId,
        thread_id: turn.threadId,
        repo_id: resolvedRepoId,
        agent_version: "dev",
        input_hash: inputHash,
        reply_hash: replyHash,
        status: turn.agentError ? "error" : "success",
        error: turn.agentError || null,
        started_at: startedAtIso,
        finished_at: startedAtIso,
      });

      if (!inserted?.id || typeof inserted.id !== "string") {
        // Even if the insert failed, facts insert will also fail; so bail cleanly.
        logger.warn(
          { inserted },
          "[repo-memory] agent_run insert did not return id; aborting facts",
        );
        return;
      }
    }

    // 4) Atomic facts (insert-only; avoid needing merge semantics for MVP)
    const fallbackFactRows = factRows.map((f) => ({
      ...f,
      repo_id: resolvedRepoId,
      source_run_id: resolvedAgentRunId,
    }));

    await supabaseInsertMany("repo_memory_facts", fallbackFactRows);

    // Optional semantic chunk insertion
    if (vectorEnabled && chunkRows) {
      const fallbackChunkRows = chunkRows.map((c) => ({
        ...c,
        repo_id: resolvedRepoId,
        source_run_id: resolvedAgentRunId,
      }));
      await supabaseInsertMany("repo_memory_chunks", fallbackChunkRows);
    }

    logger.info(
      {
        threadId: turn.threadId,
        repo: `${parsedRepo.owner}/${parsedRepo.name}`,
        agentRunId: resolvedAgentRunId,
      },
      "[repo-memory] Persisted repo memory after turn",
    );
  } catch (e) {
    logger.warn(
      { err: e },
      "[repo-memory] writeRepoMemoryAfterAgentTurn failed (non-fatal)",
    );
  }
}
