import { test, expect, describe, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { MemoryRepository } from "../../../memory/repository";
import { MemoryExtractor } from "../../../memory/extractor";
import { EmbeddingService } from "../../../memory/embeddings";
import { extractAndSaveMemories, initializeMemoryServices } from "../LinterNode";

describe("extractAndSaveMemories", () => {
    let originalMemoryEnabled;
    let saveBatchSpy;
    let extractFromTurnSpy;
    let generateEmbeddingSpy;

    beforeEach(() => {
        originalMemoryEnabled = process.env.MEMORY_ENABLED;
        process.env.MEMORY_ENABLED = "true";
        process.env.SUPABASE_URL = "http://localhost:1234";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy";
        process.env.OPENAI_API_KEY = "dummy";

        saveBatchSpy = spyOn(MemoryRepository.prototype, "saveBatch").mockResolvedValue(undefined);
        extractFromTurnSpy = spyOn(MemoryExtractor.prototype, "extractFromTurn").mockReturnValue([]);
        generateEmbeddingSpy = spyOn(EmbeddingService.prototype, "generateEmbedding").mockResolvedValue([0.1, 0.2]);

        initializeMemoryServices();
    });

    afterEach(() => {
        if (originalMemoryEnabled === undefined) {
            delete process.env.MEMORY_ENABLED;
        } else {
            process.env.MEMORY_ENABLED = originalMemoryEnabled;
        }

        saveBatchSpy.mockRestore();
        extractFromTurnSpy.mockRestore();
        generateEmbeddingSpy.mockRestore();
    });

    test("does nothing if memory is disabled", async () => {
        process.env.MEMORY_ENABLED = "false";
        await extractAndSaveMemories({ threadId: "test", userText: "hi", input: "hi" }, "test-thread");
        expect(extractFromTurnSpy).not.toHaveBeenCalled();
    });

    test("early returns if no memories extracted", async () => {
        extractFromTurnSpy.mockReturnValue([]);
        await extractAndSaveMemories({ threadId: "test", userText: "hi", input: "hi" }, "test-thread");
        expect(extractFromTurnSpy).toHaveBeenCalled();
        expect(generateEmbeddingSpy).not.toHaveBeenCalled();
        expect(saveBatchSpy).not.toHaveBeenCalled();
    });

    test("processes and saves extracted memories", async () => {
        extractFromTurnSpy.mockReturnValue([
            {
                type: "user",
                title: "Test Memory",
                content: "This is a test memory",
                metadata: { key: "value" }
            }
        ]);

        await extractAndSaveMemories({ threadId: "test", userText: "hi", input: "hi" }, "test-thread");

        expect(extractFromTurnSpy).toHaveBeenCalled();
        expect(generateEmbeddingSpy).toHaveBeenCalledWith("Test Memory. This is a test memory");
        expect(saveBatchSpy).toHaveBeenCalledWith([{
            threadId: "test-thread",
            type: "user",
            title: "Test Memory",
            content: "This is a test memory",
            metadata: { key: "value" },
            embedding: [0.1, 0.2]
        }]);
    });

    test("handles errors gracefully without throwing", async () => {
        extractFromTurnSpy.mockImplementation(() => {
            throw new Error("Extraction failed");
        });
        await extractAndSaveMemories({ threadId: "test", userText: "hi", input: "hi" }, "test-thread");
    });
});
