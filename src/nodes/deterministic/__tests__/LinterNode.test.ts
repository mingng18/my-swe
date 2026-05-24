import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";


import { MemoryRepository } from "../../../memory/repository";
import { MemoryExtractor } from "../../../memory/extractor";
import { EmbeddingService } from "../../../memory/embeddings";
import { spyOn } from "bun:test";

import { extractAndSaveMemories, initializeMemoryServices } from "../LinterNode";

describe("extractAndSaveMemories", () => {
    let mockSaveBatch: ReturnType<typeof spyOn>;
    let mockExtractFromTurn: ReturnType<typeof spyOn>;
    let mockGenerateEmbedding: ReturnType<typeof spyOn>;



    beforeEach(() => {
        process.env.MEMORY_ENABLED = "true";
        process.env.SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
        process.env.OPENAI_API_KEY = "test";

        mockSaveBatch = spyOn(MemoryRepository.prototype, "saveBatch").mockResolvedValue(undefined as any);
        mockExtractFromTurn = spyOn(MemoryExtractor.prototype, "extractFromTurn").mockReturnValue([]);
        mockGenerateEmbedding = spyOn(EmbeddingService.prototype, "generateEmbedding").mockResolvedValue([0.1, 0.2] as any);

        initializeMemoryServices();
    });

    afterEach(() => {
        mockSaveBatch.mockRestore();
        mockExtractFromTurn.mockRestore();
        mockGenerateEmbedding.mockRestore();
        process.env.MEMORY_ENABLED = "true";
        process.env.SUPABASE_URL = "";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "";
        process.env.OPENAI_API_KEY = "";
    });

    test("does nothing if memory is disabled", async () => {
        process.env.MEMORY_ENABLED = "false";

        await extractAndSaveMemories({ threadId: "test", userText: "hi", input: "hi" }, "test-thread");
        expect(mockExtractFromTurn).not.toHaveBeenCalled();
    });

    test("early returns if no memories extracted", async () => {
        mockExtractFromTurn.mockReturnValue([]);

        await extractAndSaveMemories({ threadId: "test", userText: "hi", input: "hi" }, "test-thread");
        expect(mockExtractFromTurn).toHaveBeenCalled();
        expect(mockGenerateEmbedding).not.toHaveBeenCalled();
        expect(mockSaveBatch).not.toHaveBeenCalled();
    });

    test("processes and saves extracted memories", async () => {
        mockExtractFromTurn.mockReturnValue([
            {
                type: "user",
                title: "Test Memory",
                content: "This is a test memory",
                metadata: { key: "value" }
            }
        ]);

        await extractAndSaveMemories({ threadId: "test", userText: "hi", input: "hi" }, "test-thread");

        expect(mockExtractFromTurn).toHaveBeenCalled();
        expect(mockGenerateEmbedding).toHaveBeenCalledWith("Test Memory. This is a test memory");
        expect(mockSaveBatch).toHaveBeenCalledWith([{
            threadId: "test-thread",
            type: "user",
            title: "Test Memory",
            content: "This is a test memory",
            metadata: { key: "value" },
            embedding: [0.1, 0.2]
        }]);
    });

    test("handles errors gracefully without throwing", async () => {
        mockExtractFromTurn.mockImplementation(() => {
            throw new Error("Extraction failed");
        });

        // This should not throw
        await extractAndSaveMemories({ threadId: "test", userText: "hi", input: "hi" }, "test-thread");
    });
});
