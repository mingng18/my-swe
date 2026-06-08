import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { SandboxService, SandboxServiceConfig } from "../sandbox-service";

describe("SandboxService", () => {
  let mockBackend: any;
  let service: SandboxService;

  beforeEach(() => {
    mockBackend = {
      id: "test",
      execute: mock().mockResolvedValue({ exitCode: 0, output: "exists" }),
      lsInfo: mock().mockResolvedValue([]),
      read: mock().mockResolvedValue(""),
      readRaw: mock().mockResolvedValue({ content: new Uint8Array(), encoding: "utf-8" }),
      grepRaw: mock().mockResolvedValue([]),
      globInfo: mock().mockResolvedValue([]),
      write: mock().mockResolvedValue({}),
      edit: mock().mockResolvedValue({ replaced: true }),
      uploadFiles: mock().mockResolvedValue([]),
      downloadFiles: mock().mockResolvedValue([]),
      getInfo: mock().mockResolvedValue({ id: "test", provider: "mock", containerId: "test", publicSshEndpoint: "mock" }),
      getEndpointUrl: mock().mockResolvedValue(null),
      pause: mock().mockResolvedValue(true),
      resume: mock().mockResolvedValue(null),
      renew: mock().mockResolvedValue(true),
      getWorkDir: mock().mockResolvedValue("/workspace"),
      cleanup: mock().mockResolvedValue(undefined),
      initialize: mock().mockResolvedValue(undefined),
      close: mock(),
    };

    // @ts-ignore - access private constructor for testing
    service = new SandboxService(mockBackend, "opensandbox");
  });

  afterEach(() => {
    mock.restore();
  });

  describe("shell escaping", () => {
    it("should escape shell arguments correctly", async () => {
      // Test with malicious repo name
      const maliciousRepo = 'repo"; touch /tmp/hacked; echo "';

      // We need to bypass getWorkDir throwing if the mock is set differently
      mockBackend.execute.mockResolvedValue({ exitCode: 0, output: "exists" });

      try {
        await service.cloneRepo("owner", maliciousRepo);
      } catch (e) {
        // Ignore thrown errors, check calls
      }

      const calls = mockBackend.execute.mock.calls;
      let maliciousCmdExecuted = false;

      // Verify escaping
      for (const [cmd] of calls) {
        if (cmd.includes('touch /tmp/hacked')) {
           maliciousCmdExecuted = true;
           expect(cmd).toMatch(/'.*touch \/tmp\/hacked.*'/);
        }
      }

      expect(maliciousCmdExecuted).toBe(true);
    });
  });

  describe("delegation to backend", () => {
    it("delegates read, write, edit, and other FilesystemPort methods", async () => {
      await service.read("path.txt");
      expect(mockBackend.read).toHaveBeenCalledWith("path.txt", undefined, undefined);

      await service.readRaw("path.txt");
      expect(mockBackend.readRaw).toHaveBeenCalledWith("path.txt");

      await service.write("path.txt", "content");
      expect(mockBackend.write).toHaveBeenCalledWith("path.txt", "content");

      await service.edit("path.txt", "old", "new");
      expect(mockBackend.edit).toHaveBeenCalledWith("path.txt", "old", "new", undefined);

      await service.lsInfo("path");
      expect(mockBackend.lsInfo).toHaveBeenCalledWith("path");

      await service.globInfo("pattern");
      expect(mockBackend.globInfo).toHaveBeenCalledWith("pattern", undefined);

      await service.grepRaw("pattern");
      expect(mockBackend.grepRaw).toHaveBeenCalledWith("pattern", undefined, undefined);

      const files = [["path", new Uint8Array()] as [string, Uint8Array]];
      await service.uploadFiles(files);
      expect(mockBackend.uploadFiles).toHaveBeenCalledWith(files);

      await service.downloadFiles(["path"]);
      expect(mockBackend.downloadFiles).toHaveBeenCalledWith(["path"]);
    });

    it("delegates SandboxBackendPort and management methods", async () => {
      await service.execute("ls");
      expect(mockBackend.execute).toHaveBeenCalledWith("ls");

      await service.cleanup();
      expect(mockBackend.cleanup).toHaveBeenCalled();

      await service.getInfo();
      expect(mockBackend.getInfo).toHaveBeenCalled();

      await service.getEndpointUrl(8080);
      expect(mockBackend.getEndpointUrl).toHaveBeenCalledWith(8080);

      await service.pause();
      expect(mockBackend.pause).toHaveBeenCalled();

      await service.resume();
      expect(mockBackend.resume).toHaveBeenCalled();

      await service.renew(300);
      expect(mockBackend.renew).toHaveBeenCalledWith(300);

      await service.getWorkDir();


      expect(service.id).toBe("test");
    });
  });

  describe("isDaytona / isOpenSandbox", () => {
    it("returns correctly based on provider", () => {
      expect(service.isOpenSandbox()).toBe(true);
      expect(service.isDaytona()).toBe(false);

      // @ts-ignore
      const daytonaService = new SandboxService(mockBackend, "daytona");
      expect(daytonaService.isOpenSandbox()).toBe(false);
      expect(daytonaService.isDaytona()).toBe(true);
    });
  });

  describe("getWorkspaceDir", () => {
     it("returns correct workspace directory", () => {
        expect(service.getWorkspaceDir("test-repo")).toBe("/workspace/test-repo");
     });
  });


  describe("getWorkDir", () => {
    it("returns /workspace by default", async () => {
      const dir = await service.getWorkDir();
      expect(dir).toBe("/workspace");
    });

    it("returns Daytona getWorkDir if available", async () => {
      const daytonaBackend = {
        getSandbox: () => ({
           getWorkDir: async () => "/daytona-workspace"
        })
      };

      // @ts-ignore
      const daytonaService = new SandboxService(daytonaBackend, "daytona");
      const dir = await daytonaService.getWorkDir();
      expect(dir).toBe("/daytona-workspace");
    });
  });

  describe("ensureGitAvailable", () => {
    it("returns early if git is already available", async () => {
      mockBackend.execute.mockResolvedValue({ exitCode: 0 });
      // @ts-ignore
      await service.ensureGitAvailable();
      expect(mockBackend.execute).toHaveBeenCalledWith(`sh -lc 'command -v git >/dev/null 2>&1'`);
      // Should not try to install it
      expect(mockBackend.execute).toHaveBeenCalledTimes(1);
    });

    it("attempts to install git via apt-get if missing", async () => {
      mockBackend.execute.mockImplementation(async (cmd) => {
         if (cmd.includes('command -v git')) return { exitCode: 1 };
         if (cmd.includes('apt-get')) return { exitCode: 0 };
         return { exitCode: 127 };
      });
      // @ts-ignore
      await service.ensureGitAvailable();
      expect(mockBackend.execute).toHaveBeenCalledWith(`sh -lc 'command -v apt-get >/dev/null 2>&1 && (apt-get update -y && apt-get install -y git ca-certificates) || exit 127'`);
    });

    it("attempts to install git via apk if apt-get fails", async () => {
      mockBackend.execute.mockImplementation(async (cmd) => {
         if (cmd.includes('command -v git')) return { exitCode: 1 };
         if (cmd.includes('apt-get')) return { exitCode: 127 };
         if (cmd.includes('apk')) return { exitCode: 0 };
         return { exitCode: 127 };
      });
      // @ts-ignore
      await service.ensureGitAvailable();
      expect(mockBackend.execute).toHaveBeenCalledWith(`sh -lc 'command -v apk >/dev/null 2>&1 && (apk add --no-cache git ca-certificates) || exit 127'`);
    });

    it("throws if no installation method works", async () => {
      mockBackend.execute.mockResolvedValue({ exitCode: 127 });
      // @ts-ignore
      await expect(service.ensureGitAvailable()).rejects.toThrow("git is required but was not found");
    });
  });

  describe("cloneRepo", () => {
    it("clones a repository using standard fallback if it doesn't exist", async () => {
      mockBackend.execute.mockImplementation(async (cmd) => {
         // ensureGitAvailable mock
         if (cmd.includes('command -v git')) return { exitCode: 0 };

         // directory check mock
         if (cmd.includes('test -d')) return { output: "not_found", exitCode: 0 };

         // git clone mock
         if (cmd.includes('git clone')) return { exitCode: 0 };

         return { exitCode: 0 };
      });

      const repoDir = await service.cloneRepo("owner", "repo");
      expect(repoDir).toBe("/workspace/repo");

      // verify execution flow
      const calls = mockBackend.execute.mock.calls.map(c => c[0]);
      expect(calls.some(c => c.includes("git clone"))).toBe(true);
      expect(calls.some(c => c.includes("git config user.name"))).toBe(true);
    });

    it("pulls repository using standard fallback if it already exists", async () => {
      mockBackend.execute.mockImplementation(async (cmd) => {
         if (cmd.includes('command -v git')) return { exitCode: 0 };

         // return "exists" for the test -d command
         if (cmd.includes('test -d')) return { output: "exists", exitCode: 0 };

         return { exitCode: 0, output: "main\n" };
      });

      const repoDir = await service.cloneRepo("owner", "repo");
      expect(repoDir).toBe("/workspace/repo");

      const calls = mockBackend.execute.mock.calls.map(c => c[0]);
      expect(calls.some(c => c.includes("git fetch origin"))).toBe(true);
      expect(calls.some(c => c.includes("git reset --hard origin/main"))).toBe(true);
      expect(calls.some(c => c.includes("git clone"))).toBe(false);
    });

    it("uses Daytona git toolbox to clone if provider is daytona", async () => {
      const mockGit = {
        clone: mock().mockResolvedValue(undefined),
        status: mock().mockResolvedValue({ behind: 0 }),
        pull: mock().mockResolvedValue(undefined)
      };

      const daytonaBackend = {
        getSandbox: () => ({
           git: mockGit,
           getWorkDir: async () => "/daytona-workspace"
        }),
        execute: mock().mockImplementation(async (cmd) => {
           if (cmd.includes('test -d')) return { output: "not_found", exitCode: 0 };
           return { exitCode: 0 };
        })
      };

      // @ts-ignore
      const daytonaService = new SandboxService(daytonaBackend, "daytona");
      const repoDir = await daytonaService.cloneRepo("owner", "repo");

      expect(repoDir).toBe("/daytona-workspace/repo");
      expect(mockGit.clone).toHaveBeenCalled();

      // Since Daytona handles clone natively, execute shouldn't be called for `git clone`
      const calls = daytonaBackend.execute.mock.calls.map(c => c[0]);
      expect(calls.some(c => c.includes("git clone"))).toBe(false);
    });

    it("uses Daytona git toolbox to pull if repo exists", async () => {
      const mockGit = {
        clone: mock().mockResolvedValue(undefined),
        status: mock().mockResolvedValue({ behind: 1 }),
        pull: mock().mockResolvedValue(undefined)
      };

      const daytonaBackend = {
        getSandbox: () => ({
           git: mockGit,
           getWorkDir: async () => "/daytona-workspace"
        }),
        execute: mock().mockImplementation(async (cmd) => {
           if (cmd.includes('test -d')) return { output: "exists", exitCode: 0 };
           return { exitCode: 0 };
        })
      };

      // @ts-ignore
      const daytonaService = new SandboxService(daytonaBackend, "daytona");
      const repoDir = await daytonaService.cloneRepo("owner", "repo");

      expect(repoDir).toBe("/daytona-workspace/repo");
      expect(mockGit.status).toHaveBeenCalledWith("repo");
      expect(mockGit.pull).toHaveBeenCalledWith("repo");
      expect(mockGit.clone).not.toHaveBeenCalled();
    });
  });
});
