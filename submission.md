diff --git a/src/harness/deepagents.ts b/src/harness/deepagents.ts
index 4b2fa14..97cf194 100644
--- a/src/harness/deepagents.ts
+++ b/src/harness/deepagents.ts
@@ -1,6 +1,6 @@
 import { createLogger } from "../utils/logger";
 import { threadManager, threadRepoMap, THREAD_TTL_MS, type RepoContext } from "./thread-manager";
-import { loadLlmConfig, loadModelConfig } from "../utils/config";
+import { loadLlmConfig, loadModelConfig, getSandboxProfileFromEnv } from "../utils/config";
 import { createChatModel } from "../utils/model-factory";
 import { createDeepAgent, FilesystemBackend, type DeepAgent } from "deepagents";
 import {
@@ -572,19 +572,7 @@ function extractRepoFromInput(
 // if the user doesn't re-type `--repo foo/bar`.


-function getSandboxProfileFromEnv(): SandboxProfile {
-  const p = (process.env.SANDBOX_PROFILE || "typescript").trim().toLowerCase();
-  if (
-    p === "typescript" ||
-    p === "javascript" ||
-    p === "python" ||
-    p === "java" ||
-    p === "polyglot"
-  ) {
-    return p;
-  }
-  return "typescript";
-}
+

 async function acquireDaytonaSandboxForThreadRepo(args: {
   threadId: string;
diff --git a/src/memory/supabaseRepoMemory.ts b/src/memory/supabaseRepoMemory.ts
index e119cce..59a3ce4 100644
--- a/src/memory/supabaseRepoMemory.ts
+++ b/src/memory/supabaseRepoMemory.ts
@@ -1,6 +1,9 @@
 import { randomUUID, createHash } from "node:crypto";
 import { Agent, fetch as undiciFetch } from "undici";
 import { createLogger } from "../utils/logger";
+import { getSandboxProfileFromEnv } from "../utils/config";
+import { type SandboxProfile } from "../integrations/daytona-pool";
+

 const logger = createLogger("repo-memory");

@@ -18,12 +21,7 @@ async function supabaseFetch(url: string | URL, init: RequestInit) {
   } as any);
 }

-type SandboxProfile =
-  | "typescript"
-  | "javascript"
-  | "python"
-  | "java"
-  | "polyglot";
+

 export interface RepoMemoryTurnResult {
   threadId: string;
@@ -52,19 +50,7 @@ export interface RepoMemoryTurnResult {
   };
 }

-function getSandboxProfileFromEnv(): SandboxProfile {
-  const p = (process.env.SANDBOX_PROFILE || "typescript").trim().toLowerCase();
-  if (
-    p === "typescript" ||
-    p === "javascript" ||
-    p === "python" ||
-    p === "java" ||
-    p === "polyglot"
-  ) {
-    return p;
-  }
-  return "typescript";
-}
+

 function extractRepoFromInput(
   input: string,
diff --git a/src/utils/config.ts b/src/utils/config.ts
index e5e24a8..3b431dd 100644
--- a/src/utils/config.ts
+++ b/src/utils/config.ts
@@ -1,3 +1,4 @@
+import { type SandboxProfile } from "../integrations/daytona-pool";
 import {
   detectProvider,
   type LlmProvider,
@@ -170,3 +171,18 @@ export function validateStartupConfig(): void {
   // Validate LLM configuration and optional fallback pairings.
   loadLlmConfig();
 }
+
+/** Get the sandbox profile from environment variables. */
+export function getSandboxProfileFromEnv(): SandboxProfile {
+  const p = (process.env.SANDBOX_PROFILE || "typescript").trim().toLowerCase();
+  if (
+    p === "typescript" ||
+    p === "javascript" ||
+    p === "python" ||
+    p === "java" ||
+    p === "polyglot"
+  ) {
+    return p as SandboxProfile;
+  }
+  return "typescript";
+}
