import { describe, expect, test, mock, afterEach, spyOn } from "bun:test";
import type { SandboxService } from "../../integrations/sandbox-service";
import {
	gitFetchOrigin,
	sanitizeAuthUrl,
	sanitizeTokenFromString,
	gitPush
} from "./git";

describe("gitPush", () => {
  afterEach(() => {
    mock.restore();
  });

  test("cleans up credential file on success", async () => {
    const backend = {
      execute: mock().mockImplementation(async (cmd) => {
        if (cmd.includes("remote' 'get-url' 'origin")) {
          return { exitCode: 0, output: "https://github.com/owner/repo.git\n" };
        }
        if (cmd.includes("credential.helper")) {
          return { exitCode: 0, output: "Success" };
        }
        if (cmd.includes("rm -f")) {
          return { exitCode: 0, output: "" };
        }
        return { exitCode: 0, output: "" };
      })
    };

    await gitPush(backend as any, "/repo", "main", "token");

    const calls = backend.execute.mock.calls;
    const rmCall = calls.find((c: any) => c[0].includes("rm -f"));
    expect(rmCall).toBeDefined();
  });

  test("cleans up credential file even if push fails", async () => {
    const backend = {
      execute: mock().mockImplementation(async (cmd) => {
        if (cmd.includes("remote' 'get-url' 'origin")) {
          return { exitCode: 0, output: "https://github.com/owner/repo.git\n" };
        }
        if (cmd.includes("credential.helper")) {
          return { exitCode: 1, output: "", error: "Push failed" };
        }
        if (cmd.includes("rm -f")) {
          return { exitCode: 0, output: "" };
        }
        return { exitCode: 0, output: "" };
      })
    };

    try {
      await gitPush(backend as any, "/repo", "main", "token");
    } catch(e) {}

    const calls = backend.execute.mock.calls;
    const rmCall = calls.find((c: any) => c[0].includes("rm -f"));
    expect(rmCall).toBeDefined();
  });

  test("logs error if cleanup fails", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});

    const backend = {
      execute: mock().mockImplementation(async (cmd) => {
        if (cmd.includes("remote' 'get-url' 'origin")) {
          return { exitCode: 0, output: "https://github.com/owner/repo.git\n" };
        }
        if (cmd.includes("credential.helper")) {
          return { exitCode: 0, output: "Success" };
        }
        if (cmd.includes("rm -f")) {
          throw new Error("rm failed");
        }
        return { exitCode: 0, output: "" };
      })
    };

    await gitPush(backend as any, "/repo", "main", "token");

    const calls = backend.execute.mock.calls;
    const rmCall = calls.find((c: any) => c[0].includes("rm -f"));
    expect(rmCall).toBeDefined();

    expect(errorLog).toHaveBeenCalledWith(
      "[github] Failed to clean up git credentials file",
      expect.any(Error)
    );
  });
});

describe("git", () => {
	describe("gitFetchOrigin", () => {
		test("swallows errors and returns empty string when fetch fails", async () => {
			const mockBackend = {
				execute: async () => {
					throw new Error("Network error during fetch");
				},
			} as unknown as SandboxService;

			const result = await gitFetchOrigin(mockBackend, "/path/to/repo");
			expect(result).toBe("");
		});

		test("returns result when fetch succeeds", async () => {
			const mockBackend = {
				execute: async () => ({
					exitCode: 0,
					output: "fetch success",
				}),
			} as unknown as SandboxService;

			const result = await gitFetchOrigin(mockBackend, "/path/to/repo");
			expect(result).toBe("fetch success");
		});
	});

	describe("sanitizeAuthUrl", () => {
		test("replaces token with ***", () => {
			const url =
				"https://x-access-token:ghs_1234567890abcdef@github.com/owner/repo.git";
			const sanitized = sanitizeAuthUrl(url);
			expect(sanitized).toBe("https://***@github.com/owner/repo.git");
		});

		test("handles http URLs", () => {
			const url =
				"http://x-access-token:ghs_1234567890abcdef@github.com/owner/repo.git";
			const sanitized = sanitizeAuthUrl(url);
			expect(sanitized).toBe("http://***@github.com/owner/repo.git");
		});

		test("leaves URLs without token unchanged", () => {
			const url = "https://github.com/owner/repo.git";
			const sanitized = sanitizeAuthUrl(url);
			expect(sanitized).toBe("https://github.com/owner/repo.git");
		});

		test("leaves URLs with normal auth unchanged", () => {
			const url = "https://user:pass@github.com/owner/repo.git";
			const sanitized = sanitizeAuthUrl(url);
			expect(sanitized).toBe("https://user:pass@github.com/owner/repo.git");
		});
	});
});

describe("sanitizeTokenFromString", () => {
	test("replaces a single occurrence of the token", () => {
		const msg = "Error: Authentication failed for token my-secret-token.";
		const result = sanitizeTokenFromString(msg, "my-secret-token");
		expect(result).toBe("Error: Authentication failed for token ***.");
	});

	test("replaces multiple occurrences of the token", () => {
		const msg = "Token my-secret-token was used. my-secret-token is invalid.";
		const result = sanitizeTokenFromString(msg, "my-secret-token");
		expect(result).toBe("Token *** was used. *** is invalid.");
	});

	test("handles token at the very beginning of the string", () => {
		const msg = "my-secret-token caused an error";
		const result = sanitizeTokenFromString(msg, "my-secret-token");
		expect(result).toBe("*** caused an error");
	});

	test("handles token at the very end of the string", () => {
		const msg = "Failed due to my-secret-token";
		const result = sanitizeTokenFromString(msg, "my-secret-token");
		expect(result).toBe("Failed due to ***");
	});

	test("returns original message if token is empty", () => {
		const msg = "Some error message";
		const result = sanitizeTokenFromString(msg, "");
		expect(result).toBe("Some error message");
	});

	test("returns original message if token is not found", () => {
		const msg = "Some error message without the secret";
		const result = sanitizeTokenFromString(msg, "my-secret-token");
		expect(result).toBe("Some error message without the secret");
	});

	test("handles empty message", () => {
		const result = sanitizeTokenFromString("", "my-secret-token");
		expect(result).toBe("");
	});
});
