// src/blueprints/loader.ts
import * as yaml from "js-yaml";
import * as fs from "fs/promises";
import * as path from "path";
import type { Blueprint } from "./types";

export class BlueprintValidationError extends Error {
  constructor(public blueprintId: string, public errors: string[]) {
    super(`Blueprint validation failed for '${blueprintId}': ${errors.join(", ")}`);
    this.name = "BlueprintValidationError";
  }
}

export interface LoaderOptions {
  blueprintsDir?: string;
  validate?: boolean;
}

const DEFAULT_OPTIONS: LoaderOptions = {
  blueprintsDir: ".blueprints",
  validate: true,
};

export class BlueprintLoader {
  private options: Required<LoaderOptions>;

  constructor(options: LoaderOptions = {}) {
    this.options = {
      blueprintsDir: options.blueprintsDir || DEFAULT_OPTIONS.blueprintsDir!,
      validate: options.validate !== false,
    };
  }

  async loadAll(): Promise<Blueprint[]> {
    const dir = this.options.blueprintsDir;
    const blueprints: Blueprint[] = [];
    try {
      const files = await fs.readdir(dir);
      const yamlFiles = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const file of yamlFiles) {
        const filePath = path.join(dir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const blueprint = this.parse(content, filePath);
        if (this.options.validate) this.validate(blueprint);
        blueprints.push(blueprint);
      }
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    blueprints.sort((a, b) => b.priority - a.priority);
    return blueprints;
  }

  parse(content: string, filePath?: string): Blueprint {
    try {
      const parsed = yaml.load(content) as Blueprint;
      if (!this.isBlueprint(parsed)) {
        throw new BlueprintValidationError(filePath || "unknown", ["Invalid blueprint structure"]);
      }
      return parsed;
    } catch (error: any) {
      if (error instanceof BlueprintValidationError) throw error;
      throw new BlueprintValidationError(filePath || "unknown", [error.message]);
    }
  }

  private validate(blueprint: Blueprint): void {
    const errors: string[] = [];
    if (!blueprint.id) errors.push("Missing 'id'");
    if (!blueprint.name) errors.push("Missing 'name'");
    if (!blueprint.description) errors.push("Missing 'description'");
    if (!Array.isArray(blueprint.triggerKeywords)) errors.push("Missing 'triggerKeywords'");
    if (typeof blueprint.priority !== "number") errors.push("Missing 'priority'");
    if (!blueprint.initialState) errors.push("Missing 'initialState'");
    if (!blueprint.states) errors.push("Missing 'states'");
    if (blueprint.states) {
      for (const [stateId, state] of Object.entries(blueprint.states)) {
        if (!state.type) errors.push(`State '${stateId}': missing 'type'`);
        if (state.type === "agent") {
          if (!state.config) errors.push(`State '${stateId}': missing 'config'`);
          if (!state.next) errors.push(`State '${stateId}': missing 'next'`);
        }
        if (state.type === "deterministic" && !state.action) {
          errors.push(`State '${stateId}': missing 'action'`);
        }
      }
      if (blueprint.initialState && !blueprint.states[blueprint.initialState]) {
        errors.push(`Initial state '${blueprint.initialState}' not found`);
      }
    }
    if (errors.length > 0) {
      throw new BlueprintValidationError(blueprint.id || "unknown", errors);
    }
  }

  private isBlueprint(obj: any): obj is Blueprint {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof obj.id === "string" &&
      typeof obj.name === "string" &&
      typeof obj.description === "string" &&
      Array.isArray(obj.triggerKeywords) &&
      typeof obj.priority === "number" &&
      typeof obj.initialState === "string" &&
      typeof obj.states === "object"
    );
  }
}
