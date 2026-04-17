// src/blueprints/selection.ts
import type { Blueprint, BlueprintSelection } from "./types";

interface CompiledBlueprint {
  fastPathRegex: RegExp;
  keywordRegexes: { keyword: string; regex: RegExp }[];
}

const compiledCache = new WeakMap<Blueprint, CompiledBlueprint>();

function getCompiledBlueprint(blueprint: Blueprint): CompiledBlueprint {
  let compiled = compiledCache.get(blueprint);
  if (!compiled) {
    const pattern = blueprint.triggerKeywords
      .map((k) => k.replace(/[.*+?^\$\{\}()|\[\]\\]/g, "\\$&"))
      .join("|");
    const fastPathRegex = new RegExp(pattern, "i");

    const keywordRegexes = blueprint.triggerKeywords.map((keyword) => ({
      keyword,
      regex: new RegExp(
        keyword.replace(/[.*+?^\$\{\}()|\[\]\\]/g, "\\$&"),
        "i",
      ),
    }));

    compiled = { fastPathRegex, keywordRegexes };
    compiledCache.set(blueprint, compiled);
  }
  return compiled;
}

export function selectBlueprint(
  task: string,
  blueprints: Blueprint[],
): BlueprintSelection {
  for (const blueprint of blueprints) {
    if (blueprint.triggerKeywords.length === 0) continue;

    const { fastPathRegex, keywordRegexes } = getCompiledBlueprint(blueprint);

    if (fastPathRegex.test(task)) {
      const matchedKeywords: string[] = [];
      for (const { keyword, regex } of keywordRegexes) {
        if (regex.test(task)) {
          matchedKeywords.push(keyword);
        }
      }
      return {
        blueprint,
        confidence: matchedKeywords.length / blueprint.triggerKeywords.length,
        matchedKeywords,
      };
    }
  }

  const defaultBlueprint = blueprints.find((b) => b.id === "default");
  if (!defaultBlueprint) throw new Error("No default blueprint found");
  return { blueprint: defaultBlueprint, confidence: 0, matchedKeywords: [] };
}

export function getBlueprintById(
  id: string,
  blueprints: Blueprint[],
): Blueprint | undefined {
  return blueprints.find((b) => b.id === id);
}

export function listBlueprints(blueprints: Blueprint[]): Blueprint[] {
  return [...blueprints];
}
