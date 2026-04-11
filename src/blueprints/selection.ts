// src/blueprints/selection.ts
import type { Blueprint, BlueprintSelection } from "./types";

export function selectBlueprint(task: string, blueprints: Blueprint[]): BlueprintSelection {
  const lowerTask = task.toLowerCase();
  for (const blueprint of blueprints) {
    const matchedKeywords: string[] = [];
    for (const keyword of blueprint.triggerKeywords) {
      if (lowerTask.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }
    if (matchedKeywords.length > 0) {
      return { blueprint, confidence: matchedKeywords.length / blueprint.triggerKeywords.length, matchedKeywords };
    }
  }
  const defaultBlueprint = blueprints.find((b) => b.id === "default");
  if (!defaultBlueprint) throw new Error("No default blueprint found");
  return { blueprint: defaultBlueprint, confidence: 0, matchedKeywords: [] };
}

export function getBlueprintById(id: string, blueprints: Blueprint[]): Blueprint | undefined {
  return blueprints.find((b) => b.id === id);
}

export function listBlueprints(blueprints: Blueprint[]): Blueprint[] {
  return [...blueprints];
}
