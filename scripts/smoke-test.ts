#!/usr/bin/env bun
/**
 * Smoke test for my-swe HTTP API
 *
 * Usage:
 *   bun scripts/smoke-test.ts                          # tests against localhost:3000
 *   PORT=7860 bun scripts/smoke-test.ts                # custom port
 *   bun scripts/smoke-test.ts http://staging.example.com  # custom base URL
 *
 * What it does:
 *   1. Checks /health
 *   2. Sends a simple prompt via /v1/chat/completions (no sandbox needed)
 *   3. Verifies the response shape and that the agent actually replied
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — a check failed
 *
 * Prerequisites:
 *   - Dev server must be running (`bun run start` or `bun run dev`)
 *   - USE_SANDBOX=false (or omit it) for the basic LLM test
 *   - For sandbox tests, set USE_SANDBOX=true and have a sandbox provider configured
 */

const BASE = process.argv[2] || `http://localhost:${process.env.PORT || "3000"}`;

let passed = 0;
let failed = 0;

function ok(label: string, assertion: boolean, detail?: string) {
  if (assertion) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  console.log(`\nmy-swe smoke test → ${BASE}\n`);

  // ─── 1. Health check ─────────────────────────────────────
  console.log("1. Health check");
  try {
    const res = await fetch(`${BASE}/health`);
    const json: any = await res.json();
    ok("/health returns 200", res.status === 200);
    ok("status is 'healthy'", json.status === "healthy");
    ok("service is 'codeagent'", json.service === "codeagent");
  } catch (e: any) {
    ok("server is reachable", false, e.message);
    console.log("\n  → Is the dev server running? Try: bun run start");
    process.exit(1);
  }

  // ─── 2. Info endpoint ────────────────────────────────────
  console.log("\n2. Info endpoint");
  {
    const res = await fetch(`${BASE}/info`);
    const json: any = await res.json();
    ok("/info returns 200", res.status === 200);
    ok("has middleware list", Array.isArray(json.middleware) && json.middleware.length > 0);
  }

  // ─── 3. Chat completions (LLM call) ──────────────────────
  console.log("\n3. Chat completions — agent turn");
  {
    const start = Date.now();
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "reply with exactly the word PONG and nothing else" }],
        thread_id: `smoke-${Date.now()}`,
      }),
    });

    const json: any = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    ok("returns 200", res.status === 200, `got ${res.status}`);
    ok("response has choices array", Array.isArray(json.choices) && json.choices.length > 0);
    ok("assistant message exists", json.choices?.[0]?.message?.role === "assistant");

    const content: string = json.choices?.[0]?.message?.content || "";
    ok("agent replied with content", content.length > 0, `content: "${content.slice(0, 80)}"`);
    ok("reply contains PONG", content.toUpperCase().includes("PONG"), `got: "${content.slice(0, 80)}"`);
    ok(`responded in ${elapsed}s`, true);
    ok(`tokens used: ${json.usage?.total_tokens ?? "?"}`, true);
  }

  // ─── 4. Input validation ─────────────────────────────────
  console.log("\n4. Input validation");
  {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    ok("empty messages → 400", res.status === 400, `got ${res.status}`);
  }
  {
    const res = await fetch(`${BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "" }),
    });
    ok("empty input → 400", res.status === 400, `got ${res.status}`);
  }

  // ─── 5. Webhook signature rejection ──────────────────────
  console.log("\n5. Webhook signature rejection");
  {
    const res = await fetch(`${BASE}/webhook/github`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zen: "test" }),
    });
    ok("no signature → 401", res.status === 401, `got ${res.status}`);
  }

  // ─── Summary ─────────────────────────────────────────────
  console.log(`\n${"─".repeat(40)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${"─".repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
