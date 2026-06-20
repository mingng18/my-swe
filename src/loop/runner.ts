// src/loop/runner.ts
import { BlueprintCompiler } from "../blueprints/compiler";
import { ActionRegistry } from "../blueprints/actions";
import { getAgentHarness } from "../harness";
import { deriveGoal, type GoalSpec, type VerifyProfile } from "./goal";
import { createHarnessAgentExecutor } from "./harness-executor";
import { buildVerifyRegistry } from "./verify-registry";
import {
  createStateStore,
  type StateStore,
  type LoopState,
} from "./state-store";
import {
  createTraceStore,
  type TraceStore,
  type IterationRecord,
  type TraceOutcome,
} from "./trace-store";
import {
  createHITLStore,
  type HITLStore,
  type HITLRequest,
} from "./hitl";
import type { SandboxAccessor } from "../blueprints/verification-actions";

export interface LoopRunInput {
  input: string;
  threadId: string;
  userId?: string;
  transport?: "telegram" | "http" | "github";
  goal?: Partial<GoalSpec>;
  getSandbox?: SandboxAccessor;
}

export interface LoopRunResult {
  reply: string;
  outcome: "passed" | "escalated" | "hitl_paused" | "error";
  traceId: string;
  iterations: number;
  hitl?: HITLRequest;
}

export interface LoopRunnerDeps {
  stateStore?: StateStore;
  traceStore?: TraceStore;
  hitlStore?: HITLStore;
  getHarness?: () => Promise<unknown>;
  getSandbox?: SandboxAccessor;
  /** Override the verify registry (tests). Default: buildVerifyRegistry. */
  buildRegistry?: (profile: VerifyProfile) => ActionRegistry;
  hitlEnabled?: boolean;
}

export function createLoopRunner(deps: LoopRunnerDeps = {}) {
  const stateStore = deps.stateStore ?? createStateStore();
  const traceStore = deps.traceStore ?? createTraceStore();
  const hitlStore = deps.hitlStore ?? createHITLStore();
  const hitlEnabled =
    deps.hitlEnabled ?? process.env.LOOP_HITL_ENABLED === "true";

  async function run(input: LoopRunInput): Promise<LoopRunResult> {
    const goal = deriveGoal(input.input, input.goal ?? {});
    const threadId = input.threadId;
    const getHarness = (deps.getHarness ?? (async () => getAgentHarness())) as () => Promise<any>;
    const getSandbox: SandboxAccessor =
      input.getSandbox ?? deps.getSandbox ?? (async () => undefined);

    const trace = traceStore.open(threadId, goal);
    const prior = stateStore.load(threadId);

    const executor = createHarnessAgentExecutor(getHarness, {
      threadId,
      userId: input.userId,
      transport: input.transport,
    });
    const buildRegistry =
      deps.buildRegistry ?? ((p: VerifyProfile) => buildVerifyRegistry(getSandbox, p));
    const registry = buildRegistry(goal.verifyProfile);
    const graph = new BlueprintCompiler(
      registry,
      executor,
    ).compileWithFeedbackLoop(goal.maxIterations);

    try {
      const finalState = (await graph.invoke(
        {
          input: input.input,
          currentState: "agent",
          goal,
          traceId: trace.traceId,
          iteration: prior?.iteration ?? 0,
          maxIterations: goal.maxIterations,
          verificationResults: [],
          agentMessages: [],
        } as any,
        { recursionLimit: Math.max(24, goal.maxIterations * 6 + 10) },
      )) as any;

      const escalated = finalState.loopOutcome === "escalated";
      const iterationCount = Number(finalState.iteration ?? 0);
      let outcome: LoopRunResult["outcome"] = escalated
        ? "escalated"
        : "passed";

      let hitl: HITLRequest | undefined;
      if (outcome === "escalated" && hitlEnabled) {
        outcome = "hitl_paused";
        hitl = hitlStore.create({
          threadId,
          traceId: trace.traceId,
          reason: `Verification failed after ${iterationCount} iteration(s)`,
          pendingAction: "create_pr",
          options: ["approve", "reject", "modify"],
        });
      }

      const decision: IterationRecord["decision"] =
        outcome === "passed" ? "pass" : outcome === "hitl_paused" ? "hitl" : "escalate";
      traceStore.appendIteration(trace.traceId, {
        index: iterationCount,
        agentOutput: finalState.lastResult?.output ?? "",
        verification: finalState.verificationResults ?? [],
        decision,
      });
      const traceOutcome: TraceOutcome =
        outcome === "passed" ? "passed" : outcome === "hitl_paused" ? "hitl_paused" : "escalated";
      traceStore.finalize(trace.traceId, traceOutcome);

      const next: LoopState = {
        threadId,
        goal,
        iteration: iterationCount,
        done: outcome === "passed" ? ["task"] : [],
        next: outcome === "passed" ? [] : ["resolve failures"],
        tried: [],
        lastError: escalated ? finalState.error : undefined,
        hitl: hitl
          ? {
              requestId: hitl.requestId,
              reason: hitl.reason,
              pendingAction: hitl.pendingAction,
            }
          : undefined,
        traceId: trace.traceId,
        updatedAt: new Date().toISOString(),
      };
      stateStore.save(next);

      const reply =
        outcome === "passed"
          ? `✅ Loop passed in ${iterationCount} iteration(s).`
          : outcome === "hitl_paused"
            ? `⏸️ Hit the verification ceiling after ${iterationCount} iteration(s); approval requested (${hitl!.requestId}).`
            : `⚠️ Escalated after ${iterationCount} iteration(s): ${finalState.error ?? ""}`;

      return { reply, outcome, traceId: trace.traceId, iterations: iterationCount, hitl };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      traceStore.finalize(trace.traceId, "error");
      return {
        reply: `Error: ${msg}`,
        outcome: "error",
        traceId: trace.traceId,
        iterations: 0,
      };
    }
  }

  return { run, hitlStore, stateStore, traceStore };
}
