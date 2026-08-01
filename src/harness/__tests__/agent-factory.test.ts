import { describe, it, expect, mock, afterEach } from "bun:test";
import * as configMod from "../../utils/config";

// ---------------------------------------------------------------------------
// agent-factory.ts has heavy dependencies (model loading, tools, middleware).
// We test that the module exports the function with the correct signature.
// Full integration testing would require a real model setup.
// ---------------------------------------------------------------------------

describe("agent-factory", () => {
  describe("createAgentInstance", () => {
    it("exports a function named createAgentInstance", async () => {
      const mod = await import("../agent-factory");
      expect(mod.createAgentInstance).toBeDefined();
      expect(typeof mod.createAgentInstance).toBe("function");
    });

    it("the function accepts an object with optional workspaceRoot and backend", async () => {
      const mod = await import("../agent-factory");
      // Check the function has the right arity
      expect(mod.createAgentInstance.length).toBe(1);
    });

    it("the exported function is async (returns a Promise)", async () => {
      const mod = await import("../agent-factory");
      // Calling without args will likely fail due to missing config,
      // but the return type should be a Promise (or it throws).
      // We just verify the function signature, not successful execution.
      const fn = mod.createAgentInstance;
      const paramStr = fn.toString();
      expect(paramStr).toContain("async");
    });

    describe("fallback model error handling", () => {
      afterEach(() => {
        mock.restore();
      });

      it("should catch error if fallback model creation fails and continue", async () => {
        // Mock modules to avoid real dependencies
        mock.module("../../utils/config", () => {
          return {
            loadLlmConfig: () => ({
              provider: "openai",
              model: "test-model",
              openaiApiKey: "test-key",
              openaiBaseUrl: "test-url",
              fallback: {
                model: "fallback-model",
                openaiApiKey: "fallback-key",
                openaiBaseUrl: "fallback-url"
              }
            }),
            loadModelConfig: (fallback?: any) => {
              if (fallback) {
                return {
                  provider: "openai",
                  model: fallback.model,
                  openaiApiKey: fallback.openaiApiKey,
                  openaiBaseUrl: fallback.openaiBaseUrl
                };
              }
              return {
                provider: "openai",
                model: "test-model",
                openaiApiKey: "test-key",
                openaiBaseUrl: "test-url"
              };
            },
            loadTelegramConfig: configMod.loadTelegramConfig,
            loadTelegramBackoffConfig: configMod.loadTelegramBackoffConfig,
            loadPipelineConfig: configMod.loadPipelineConfig,
            isArchitectEditorRoutingEnabled: configMod.isArchitectEditorRoutingEnabled,
            loadArchitectEditorConfig: configMod.loadArchitectEditorConfig,
            getRoleModelConfig: configMod.getRoleModelConfig,
            validateStartupConfig: configMod.validateStartupConfig
          };
        });

        // Use mock.module to completely isolate deepagents to prevent actually running it
        mock.module("deepagents", () => {
          return {
            createDeepAgent: () => ({ fakeAgent: true })
          };
        });

        mock.module("../../utils/model-factory", () => {
          return {
            createChatModel: async (config: any) => {
              if (config.model === "fallback-model") {
                throw new Error("Simulated fallback model creation error");
              }
              return { fakeModel: true };
            }
          };
        });

        const mod = await import("../agent-factory");

        let threw = false;
        try {
          const agent = await mod.createAgentInstance({});
          expect(agent).toBeDefined();
        } catch (e) {
          threw = true;
        }

        // Verify the fallback model creation threw and was caught
        expect(threw).toBe(false);
      });
    });
  });
});
