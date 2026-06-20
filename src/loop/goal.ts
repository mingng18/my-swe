// src/loop/goal.ts
export type VerifyProfile = "tests" | "tests+lint" | "tests+lint+typecheck" | "eval";
export type AutonomyLevel = "report" | "assisted" | "unattended";

export interface GoalSpec {
  objective: string;
  acceptanceCriteria: string[];
  maxIterations: number;
  budgetCeiling?: { tokens?: number; cost?: number };
  autonomyLevel: AutonomyLevel;
  verifyProfile: VerifyProfile;
}

export interface DeriveGoalOptions {
  maxIterations?: number;
  verifyProfile?: VerifyProfile;
  autonomyLevel?: AutonomyLevel;
}

export function deriveGoal(task: string, opts: DeriveGoalOptions = {}): GoalSpec {
  const maxIterations =
    opts.maxIterations ??
    Number(process.env.LOOP_MAX_ITERATIONS ?? "3");
  const autonomyLevel =
    opts.autonomyLevel ??
    ((process.env.LOOP_AUTONOMY_LEVEL as AutonomyLevel | undefined) ??
      "assisted");
  const verifyProfile: VerifyProfile = opts.verifyProfile ?? "tests+lint";

  const acceptanceCriteria: string[] = ["tests pass"];
  if (verifyProfile.includes("lint")) acceptanceCriteria.push("lint clean");
  if (verifyProfile.includes("typecheck"))
    acceptanceCriteria.push("typecheck clean");

  return {
    objective: task,
    acceptanceCriteria,
    maxIterations,
    autonomyLevel,
    verifyProfile,
  };
}
