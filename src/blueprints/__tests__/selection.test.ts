// src/blueprints/__tests__/selection.test.ts
import { describe, expect, it } from "bun:test";
import {
	getBlueprintById,
	listBlueprints,
	selectBlueprint,
} from "../selection";
import type { Blueprint } from "../types";

describe("Blueprint Selection", () => {
	const blueprints: Blueprint[] = [
		{
			id: "bug-fix",
			name: "Bug Fix",
			description: "Fix bugs",
			triggerKeywords: ["fix", "bug"],
			priority: 100,
			initialState: "start",
			states: { start: { type: "terminal" } },
		},
		{
			id: "default",
			name: "Default",
			description: "Default",
			triggerKeywords: [],
			priority: 0,
			initialState: "start",
			states: { start: { type: "terminal" } },
		},
	];

	it("should select blueprint by keyword match", () => {
		const selection = selectBlueprint("fix the bug", blueprints);
		expect(selection.blueprint.id).toBe("bug-fix");
		expect(selection.matchedKeywords).toContain("fix");
	});

	it("should return default when no match", () => {
		const selection = selectBlueprint("random task", blueprints);
		expect(selection.blueprint.id).toBe("default");
		expect(selection.confidence).toBe(0);
	});

	it("should throw error if default blueprint is not found", () => {
		const invalidBlueprints: Blueprint[] = [
			{
				id: "bug-fix",
				name: "Bug Fix",
				description: "Fix bugs",
				triggerKeywords: ["fix", "bug"],
				priority: 100,
				initialState: "start",
				states: { start: { type: "terminal" } },
			},
		];
		expect(() => selectBlueprint("random task", invalidBlueprints)).toThrow(
			"No default blueprint found",
		);
	});

	it("should return correct blueprint when calling getBlueprintById", () => {
		const b = getBlueprintById("bug-fix", blueprints);
		expect(b).toBeDefined();
		expect(b?.id).toBe("bug-fix");
	});

	it("should return undefined when calling getBlueprintById with invalid id", () => {
		const b = getBlueprintById("non-existent", blueprints);
		expect(b).toBeUndefined();
	});

	it("should list blueprints using listBlueprints", () => {
		const b = listBlueprints(blueprints);
		expect(b).toEqual(blueprints);
		expect(b).not.toBe(blueprints); // it should return a new array
	});

	it("should skip blueprints with undefined triggerKeywords", () => {
		const undefinedKeywordBlueprints = [
			{
				id: "undefined-keywords",
				name: "Undefined",
				description: "Undefined keywords",
				priority: 100,
				initialState: "start",
				states: { start: { type: "terminal" } },
			} as Blueprint,
			{
				id: "default",
				name: "Default",
				description: "Default",
				triggerKeywords: [],
				priority: 0,
				initialState: "start",
				states: { start: { type: "terminal" } },
			},
		];
		const selection = selectBlueprint("some task", undefinedKeywordBlueprints);
		expect(selection.blueprint.id).toBe("default");
	});

	it("should handle triggerKeywords with special regex characters", () => {
		const regexBlueprints: Blueprint[] = [
			{
				id: "c++",
				name: "C++",
				description: "C++ task",
				triggerKeywords: ["c++", "react.js"],
				priority: 100,
				initialState: "start",
				states: { start: { type: "terminal" } },
			},
			{
				id: "default",
				name: "Default",
				description: "Default",
				triggerKeywords: [],
				priority: 0,
				initialState: "start",
				states: { start: { type: "terminal" } },
			},
		];

		let selection = selectBlueprint("I need help with c++", regexBlueprints);
		expect(selection.blueprint.id).toBe("c++");
		expect(selection.matchedKeywords).toContain("c++");

		selection = selectBlueprint("How to use react.js", regexBlueprints);
		expect(selection.blueprint.id).toBe("c++");
		expect(selection.matchedKeywords).toContain("react.js");
	});

	it("should calculate confidence correctly", () => {
		const multipleKeywordBlueprints: Blueprint[] = [
			{
				id: "frontend",
				name: "Frontend",
				description: "Frontend task",
				triggerKeywords: ["react", "ui"],
				priority: 100,
				initialState: "start",
				states: { start: { type: "terminal" } },
			},
			{
				id: "default",
				name: "Default",
				description: "Default",
				triggerKeywords: [],
				priority: 0,
				initialState: "start",
				states: { start: { type: "terminal" } },
			},
		];

		// Matches 1 out of 2 keywords
		let selection = selectBlueprint("react state", multipleKeywordBlueprints);
		expect(selection.blueprint.id).toBe("frontend");
		expect(selection.confidence).toBe(0.5);

		// Matches 2 out of 2 keywords
		selection = selectBlueprint("react ui bug", multipleKeywordBlueprints);
		expect(selection.blueprint.id).toBe("frontend");
		expect(selection.confidence).toBe(1);
	});

	it("should use cache correctly on subsequent calls", () => {
		// First call caches the compiled regex
		const selection1 = selectBlueprint("fix the bug", blueprints);
		expect(selection1.blueprint.id).toBe("bug-fix");

		// Second call should use the cache
		const selection2 = selectBlueprint("fix another bug", blueprints);
		expect(selection2.blueprint.id).toBe("bug-fix");
	});
});
