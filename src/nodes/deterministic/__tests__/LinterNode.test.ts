import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";

let mockSaveBatch = mock().mockResolvedValue(undefined);
let mockExtractFromTurn = mock().mockReturnValue([]);
let mockGenerateEmbedding = mock().mockResolvedValue([0.1, 0.2]);

mock.module("../../../memory/repository", () => ({
  MemoryRepository: class {
    saveBatch = mockSaveBatch; getByThread = mock(); save = mock();
  }
}));

mock.module("../../../memory/extractor", () => ({
  MemoryExtractor: class {
    extractFromTurn = mockExtractFromTurn;
  }
}));

mock.module("../../../memory/embeddings", () => ({
  EmbeddingService: class {
    generateEmbedding = mockGenerateEmbedding;
  }
}));

import { extractAndSaveMemories, initializeMemoryServices } from "../LinterNode";

describe("extractAndSaveMemories", () => {
    let originalMemoryEnabled: string | undefined;

    beforeEach(() => {
        originalMemoryEnabled = process.env.MEMORY_ENABLED;
        process.env.MEMORY_ENABLED = "true";

        mockSaveBatch.mockClear();
        mockExtractFromTurn.mockClear();
        mockGenerateEmbedding.mockClear();

        initializeMemoryServices();
    });

    afterEach(() => {
        if (originalMemoryEnabled === undefined) {
            delete process.env.MEMORY_ENABLED;
        } else {
            process.env.MEMORY_ENABLED = originalMemoryEnabled;
        }
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
