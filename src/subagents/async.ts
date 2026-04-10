import { type AsyncSubAgent } from "deepagents";

export const asyncSubagents: AsyncSubAgent[] = [
  {
    name: "verification-agent",
    description: "Verification specialist that tries to break implementations. Runs builds, tests, linters, and adversarial probes. Use after non-trivial changes (3+ file edits, backend/API changes, infrastructure changes).",
    graphId: "verification",
    // No url → ASGI transport (co-deployed)
  },
];
