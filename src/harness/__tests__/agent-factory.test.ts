import { describe, it, expect, mock, spyOn, afterEach } from "bun:test";
import * as configMod from "../../utils/config";
import * as modelFactoryMod from "../../utils/model-factory";
import { ChatOpenAI } from "@langchain/openai";

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
        const loadLlmConfigSpy = spyOn(configMod, "loadLlmConfig").mockReturnValue({
          provider: "openai",
          model: "test-model",
          openaiApiKey: "test-key",
          openaiBaseUrl: "test-url",
          fallback: {
            model: "fallback-model",
            openaiApiKey: "fallback-key",
            openaiBaseUrl: "fallback-url"
          }
        } as any);

        const loadModelConfigSpy = spyOn(configMod, "loadModelConfig").mockImplementation((fallback?: any) => {
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
        });

        const createChatModelSpy = spyOn(modelFactoryMod, "createChatModel").mockImplementation(async (config: any) => {
          if (config.model === "fallback-model") {
            throw new Error("Simulated fallback model creation error");
          }
          // Return a real model so that deepagents doesn't fail internally
          return new ChatOpenAI({
            modelName: "test-model",
            openAIApiKey: "test-key"
          });
        });

        const mod = await import("../agent-factory");

        let threw = false;
        let agent;
        try {
          agent = await mod.createAgentInstance({});
        } catch (e) {
          threw = true;
        }

        expect(threw).toBe(false);
        expect(agent).toBeDefined();

        // Assert that the fallback path was actually exercised
        expect(loadLlmConfigSpy).toHaveBeenCalled();
        expect(createChatModelSpy).toHaveBeenCalledTimes(2);

        // The first call should be the main model, the second should be the fallback model
        const fallbackCall = createChatModelSpy.mock.calls[1][0];
        expect(fallbackCall.model).toBe("fallback-model");
      });
    });
  });
});
