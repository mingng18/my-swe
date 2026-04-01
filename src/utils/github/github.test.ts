import { describe, expect, test } from "bun:test";
import { gitPush, gitRemoteBranchExists } from "./github";
import type { SandboxService } from "../../integrations/sandbox-service";

interface FakeExecuteResponse {
  exitCode?: number;
  output: string;
  error?: string;
}

class FakeSandbox {
  constructor(private readonly responses: FakeExecuteResponse[]) {}

  async execute(_command: string): Promise<FakeExecuteResponse> {
    const next = this.responses.shift();
    return next ?? { exitCode: 0, output: "" };
  }

  async write(_filePath: string, _content: string): Promise<void> {
    return;
  }
}

describe("github utils", () => {
  test("gitRemoteBranchExists returns true when ls-remote succeeds", async () => {
    const backend = new FakeSandbox([{ exitCode: 0, output: "sha\trefs/heads/feat" }]);
    const exists = await gitRemoteBranchExists(
      backend as unknown as SandboxService,
      "/tmp/repo",
      "feat",
    );
    expect(exists).toBe(true);
  });

  test("gitPush throws when git push exits non-zero", async () => {
    const backend = new FakeSandbox([{ exitCode: 1, output: "permission denied" }]);
    await expect(
      gitPush(backend as unknown as SandboxService, "/tmp/repo", "feat"),
    ).rejects.toThrow("Git command failed");
  });
});
