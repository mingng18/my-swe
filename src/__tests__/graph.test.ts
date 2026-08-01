import { describe, expect, it, mock } from "bun:test";

mock.module("../server.js", () => ({
	runCodeagentTurn: mock(
		async (input: string, threadId: string) =>
			`Mocked reply to ${input} on thread ${threadId}`,
	),
}));

describe("getGraphForExport", () => {
	it("returns a compiled graph object", async () => {
		const { getGraphForExport } = await import("../graph");
		const graph = getGraphForExport();
		expect(graph).toBeDefined();
		expect(typeof graph.invoke).toBe("function");
		expect(typeof graph.stream).toBe("function");
	});

	it("compiled graph has a nodes property or can be inspected", async () => {
		const { getGraphForExport } = await import("../graph");
		const graph = getGraphForExport();
		expect(graph).toHaveProperty("invoke");
	});

	it("agent node delegates to runCodeagentTurn", async () => {
		const { getGraphForExport } = await import("../graph");
		const graph = getGraphForExport();
		const result = await graph.invoke(
			{
				input: "Hello World",
				threadId: "thread-123",
				messages: [],
			},
			{
				configurable: { thread_id: "thread-123" },
			},
		);

		expect(result.messages).toEqual([
			{
				role: "assistant",
				content: "Mocked reply to Hello World on thread thread-123",
			},
		]);
	});
});
