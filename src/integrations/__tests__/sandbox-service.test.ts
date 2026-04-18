import { describe, it, expect, mock } from "bun:test";
import { SandboxService } from "../sandbox-service";

describe("SandboxService", () => {
  it("should escape shell arguments correctly", async () => {
    // We can't access escapeShellArg directly as it's not exported,
    // but we can test cloneRepo with malicious names.
    const mockBackend = {
      id: "test",
      execute: mock().mockResolvedValue({ exitCode: 0, output: "exists" }),
      lsInfo: mock(),
      read: mock(),
      write: mock(),
      edit: mock(),
      close: mock(),
      getWorkDir: mock().mockResolvedValue("/workspace")
    };

    // Create a SandboxService with a mock backend
    // @ts-ignore - access private constructor for testing
    const service = new SandboxService(mockBackend, "opensandbox");

    // Test with malicious repo name
    const maliciousRepo = 'repo"; touch /tmp/hacked; echo "';

    try {
      await service.cloneRepo("owner", maliciousRepo);
    } catch (e) {
      // It might throw later, but we care about the mock arguments
    }

    // Check the calls
    const calls = mockBackend.execute.mock.calls;

    // Verify escaping
    for (const [cmd] of calls) {
      if (cmd.includes('touch /tmp/hacked')) {
         expect(cmd).toMatch(/'.*touch \/tmp\/hacked.*'/);
      }
    }
  });
});
