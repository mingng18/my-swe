import { findExistingPr } from "./src/utils/github/github";
import { Octokit } from "octokit";

async function run() {
  const token = process.env.GITHUB_TOKEN || "fake_token";

  // Mock Octokit locally to measure our logic without actually hitting network/auth errors
  // but let's actually just mock fetch globally for the benchmark.

  const mockFetch = async (url: string, init?: RequestInit) => {
    // simulate some delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // For 'open' state, let's say it returns empty so it moves to 'all'
    if (url.includes('state=open')) {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    // For 'all' state, return a mock PR
    if (url.includes('state=all')) {
      return new Response(JSON.stringify([{ html_url: "mock_url", number: 123 }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  globalThis.fetch = mockFetch as any;

  console.time("findExistingPr");
  await findExistingPr("bullhorse", "bullhorse", "bullhorse", token, "main");
  console.timeEnd("findExistingPr");
}

run().catch(console.error);
