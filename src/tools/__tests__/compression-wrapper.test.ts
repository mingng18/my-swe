import { describe, expect, test, mock, afterEach, beforeEach, spyOn } from "bun:test";
import { wrapToolWithCompression, wrapToolsWithCompression, createToolWrapper } from "../compression-wrapper";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as outputCompressor from "../../utils/output-compressor";

describe("Compression Wrapper", () => {
    let mockCompressOutput: any;

    beforeEach(() => {
        mockCompressOutput = spyOn(outputCompressor, 'compressOutput').mockImplementation((output: string, context: any) => {
            return {
                output: `COMPRESSED:${output}`,
                originalSize: output.length,
                compressedSize: output.length + 11,
                strategy: "test_strategy",
                metadata: {
                    savingsRatio: 0.5
                }
            };
        });
    });

    afterEach(() => {
        mock.restore();
    });

    test("should skip compression for SKIP_TOOLS", () => {
        const skipTool = new DynamicStructuredTool({
            name: "github_comment",
            description: "description",
            schema: z.object({}),
            func: async () => "result"
        });

        const wrapped = wrapToolWithCompression(skipTool);
        expect(wrapped).toBe(skipTool); // Same instance returned
    });

    test("should compress string output", async () => {
        const testTool = new DynamicStructuredTool({
            name: "test_tool",
            description: "description",
            schema: z.object({}),
            func: async () => "test_output"
        });

        const wrapped = wrapToolWithCompression(testTool);

        // We need to invoke the tool properly
        const result = await wrapped.invoke({});

        expect(result).toBe("COMPRESSED:test_output");
        expect(mockCompressOutput).toHaveBeenCalled();
    });

    test("should handle object output with exitCode", async () => {
        const testTool = new DynamicStructuredTool({
            name: "test_tool",
            description: "description",
            schema: z.object({ command: z.string() }),
            func: async () => ({ exitCode: 1, output: "test_output" })
        });

        const wrapped = wrapToolWithCompression(testTool);
        const result = await wrapped.invoke({ command: "ls -la" });

        const parsed = JSON.parse(result);
        expect(parsed.exitCode).toBe(1);
        expect(parsed.output).toBe("test_output");
        expect(parsed.stdout).toBe('COMPRESSED:{"exitCode":1,"output":"test_output"}');
        expect(parsed._compressed).toBe(true);
        expect(parsed._compressionInfo).toEqual({ savingsRatio: 0.5 });
        expect(mockCompressOutput).toHaveBeenCalledWith(
            '{"exitCode":1,"output":"test_output"}',
            { toolName: "test_tool", exitCode: 1, threadId: undefined, command: "ls -la" }
        );
    });

    test("should handle other types of output", async () => {
        const testTool = new DynamicStructuredTool({
            name: "test_tool",
            description: "description",
            schema: z.object({}),
            func: async () => 42
        });

        const wrapped = wrapToolWithCompression(testTool);
        const result = await wrapped.invoke({});

        expect(result).toBe("COMPRESSED:42");
        expect(mockCompressOutput).toHaveBeenCalledWith(
            '42',
            { toolName: "test_tool", exitCode: 0, threadId: undefined, command: undefined }
        );
    });

    test("wrapToolsWithCompression should wrap multiple tools", () => {
        const testTool1 = new DynamicStructuredTool({
            name: "test_tool1",
            description: "description",
            schema: z.object({}),
            func: async () => "output1"
        });
        const testTool2 = new DynamicStructuredTool({
            name: "test_tool2",
            description: "description",
            schema: z.object({}),
            func: async () => "output2"
        });

        const wrappedTools = wrapToolsWithCompression([testTool1, testTool2]);
        expect(wrappedTools.length).toBe(2);
        expect(wrappedTools[0].name).toBe("test_tool1");
        expect(wrappedTools[1].name).toBe("test_tool2");
        expect(wrappedTools[0]).not.toBe(testTool1);
        expect(wrappedTools[1]).not.toBe(testTool2);
    });

    test("createToolWrapper should return a function that wraps a tool", () => {
        const wrapper = createToolWrapper(() => "thread-123");

        const testTool = new DynamicStructuredTool({
            name: "test_tool",
            description: "description",
            schema: z.object({}),
            func: async () => "output"
        });

        const wrappedTool = wrapper(testTool);
        expect(wrappedTool.name).toBe("test_tool");
        expect(wrappedTool).not.toBe(testTool);
    });
});


describe("Compression Wrapper Error Handling", () => {
    let mockCompressOutput: any;

    beforeEach(() => {
        mockCompressOutput = spyOn(outputCompressor, 'compressOutput').mockImplementation((output: string, context: any) => {
            return {
                output: `COMPRESSED:${output}`,
                originalSize: output.length,
                compressedSize: output.length + 11,
                strategy: "test_strategy",
                metadata: {
                    savingsRatio: 0.5
                }
            };
        });
    });

    afterEach(() => {
        mock.restore();
    });

    test("should handle JSON.stringify failures when constructing return object", async () => {
        // Here we test the fallback block at the end of the wrapper
        // To trigger it, we need originalResult to be an object
        // but somehow cause the final JSON.stringify to fail.
        // Actually, JSON.stringify rarely fails on simple object unless there are bigints or circular structures.
        // We'll mock JSON.stringify temporarily
        const testTool = new DynamicStructuredTool({
            name: "test_tool",
            description: "description",
            schema: z.object({}),
            func: async () => ({ exitCode: 0, output: "test_output" })
        });

        const originalStringify = JSON.stringify;
        let stringifyCount = 0;

        // We spy on JSON.stringify to fail on the second call (when constructing return obj)
        spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
            stringifyCount++;
            if (stringifyCount === 2) { // The one at the end of wrapToolFunctionWithCompression
                throw new Error("Mock serialization error");
            }
            return originalStringify(value, replacer as any, space as any);
        });

        const wrapped = wrapToolWithCompression(testTool);
        const result = await wrapped.invoke({});

        // Should fall back to returning compressed.output directly
        expect(result).toBe('COMPRESSED:{"exitCode":0,"output":"test_output"}');
    });

    test("should capture and pass threadId appropriately", async () => {
        const testTool = new DynamicStructuredTool({
            name: "test_tool",
            description: "description",
            schema: z.object({}),
            func: async () => "test_output"
        });

        const wrapped = wrapToolWithCompression(testTool, () => "thread-123");
        await wrapped.invoke({});

        expect(mockCompressOutput).toHaveBeenCalledWith(
            "test_output",
            { toolName: "test_tool", exitCode: 0, threadId: "thread-123", command: undefined }
        );
    });
});
