import { createLogger } from "./logger";
import path from "path";

const logger = createLogger("progressive-file-reader");

/**
 * Symbol information extracted from a file.
 */
export interface SymbolInfo {
  name: string;
  type: "function" | "class" | "interface" | "type" | "variable" | "constant" | "unknown";
  line: number;
  endLine?: number;
  exports: boolean;
}

/**
 * File structure with symbols.
 */
export interface FileStructure {
  path: string;
  imports: Array<{ name: string; from: string; line: number }>;
  exports: Array<{ name: string; line: number }>;
  symbols: SymbolInfo[];
}

/**
 * Extract symbols from TypeScript/JavaScript code using regex.
 * This is a simplified approach that works for most cases.
 */
export function extractSymbols(content: string, filePath: string): FileStructure {
  const lines = content.split("\n");
  const structure: FileStructure = {
    path: filePath,
    imports: [],
    exports: [],
    symbols: [],
  };

  const isTypeScript = filePath.endsWith(".ts") || filePath.endsWith(".tsx");
  const isJavaScript =
    filePath.endsWith(".js") || filePath.endsWith(".jsx") || filePath.endsWith(".mjs");

  if (!isTypeScript && !isJavaScript) {
    return structure;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNumber = i + 1;

    // Extract imports
    const importMatch = trimmed.match(
      /^import\s+(?:(\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/,
    );
    if (importMatch) {
      const names = importMatch[1];
      const from = importMatch[2];
      if (names) {
        // Handle named imports
        const namedImports = names.replace(/[{}]/g, "").split(",").map((s) => s.trim());
        for (const name of namedImports) {
          structure.imports.push({ name, from, line: lineNumber });
        }
      }
    }

    // Extract exports
    if (trimmed.startsWith("export ")) {
      const functionMatch = trimmed.match(/export\s+(?:async\s+)?function\s+(\w+)/);
      const classMatch = trimmed.match(/export\s+class\s+(\w+)/);
      const constMatch = trimmed.match(/export\s+const\s+(\w+)/);
      const namedMatch = trimmed.match(/export\s*\{([^}]+)\}/);

      if (functionMatch) {
        structure.exports.push({ name: functionMatch[1], line: lineNumber });
        structure.symbols.push({
          name: functionMatch[1],
          type: "function",
          line: lineNumber,
          exports: true,
        });
      } else if (classMatch) {
        structure.exports.push({ name: classMatch[1], line: lineNumber });
        structure.symbols.push({
          name: classMatch[1],
          type: "class",
          line: lineNumber,
          exports: true,
        });
      } else if (constMatch) {
        structure.exports.push({ name: constMatch[1], line: lineNumber });
        structure.symbols.push({
          name: constMatch[1],
          type: "constant",
          line: lineNumber,
          exports: true,
        });
      } else if (namedMatch) {
        const names = namedMatch[1].split(",").map((s) => s.trim());
        for (const name of names) {
          structure.exports.push({ name, line: lineNumber });
        }
      }
    }

    // Extract function definitions (non-exported)
    const funcMatch = trimmed.match(
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    );
    if (funcMatch) {
      const existing = structure.symbols.find((s) => s.name === funcMatch[1]);
      if (!existing) {
        structure.symbols.push({
          name: funcMatch[1],
          type: "function",
          line: lineNumber,
          exports: trimmed.startsWith("export "),
        });
      }
    }

    // Extract class definitions (non-exported)
    const classMatch = trimmed.match(/^class\s+(\w+)/);
    if (classMatch) {
      const existing = structure.symbols.find((s) => s.name === classMatch[1]);
      if (!existing) {
        structure.symbols.push({
          name: classMatch[1],
          type: "class",
          line: lineNumber,
          exports: trimmed.startsWith("export "),
        });
      }
    }

    // Extract interface definitions (TypeScript)
    if (isTypeScript) {
      const interfaceMatch = trimmed.match(/^export\s+interface\s+(\w+)/);
      const typeMatch = trimmed.match(/^export\s+type\s+(\w+)/);

      if (interfaceMatch) {
        structure.symbols.push({
          name: interfaceMatch[1],
          type: "interface",
          line: lineNumber,
          exports: true,
        });
      }

      if (typeMatch) {
        structure.symbols.push({
          name: typeMatch[1],
          type: "type",
          line: lineNumber,
          exports: true,
        });
      }
    }
  }

  return structure;
}

/**
 * Find the line range for a symbol in a file.
 */
export function findSymbolRange(
  content: string,
  symbolName: string,
): { startLine: number; endLine: number } | null {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Look for function/class/interface definition
    const patterns = [
      new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${symbolName}\\b`),
      new RegExp(`^(?:export\\s+)?class\\s+${symbolName}\\b`),
      new RegExp(`^interface\\s+${symbolName}\\b`),
      new RegExp(`^type\\s+${symbolName}\\b`),
      new RegExp(`^(?:export\\s+)?const\\s+${symbolName}\\s*=`),
    ];

    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        // Found the symbol, now find its end
        const startLine = i + 1;
        let endLine = startLine;
        let braceDepth = 0;
        let foundBrace = false;

        for (let j = i; j < lines.length; j++) {
          const l = lines[j];
          for (const char of l) {
            if (char === "{") {
              braceDepth++;
              foundBrace = true;
            } else if (char === "}") {
              braceDepth--;
            }
          }

          if (foundBrace && braceDepth === 0) {
            endLine = j + 1;
            break;
          }
        }

        // If no braces found, assume single line
        if (!foundBrace) {
          endLine = startLine;
        }

        return { startLine, endLine };
      }
    }
  }

  return null;
}

/**
 * Get imports section of a file (first N lines).
 */
export function getImportsSection(content: string, maxLines: number = 50): string {
  const lines = content.split("\n");
  const importLines: string[] = [];

  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const line = lines[i].trim();
    if (
      line.startsWith("import ") ||
      line.startsWith("export ") ||
      line.startsWith("from ") ||
      line.startsWith("require(")
    ) {
      importLines.push(lines[i]);
    } else if (importLines.length > 0 && line === "") {
      // Continue through blank lines after imports
      importLines.push(lines[i]);
    } else if (importLines.length > 0) {
      // End of imports section
      break;
    }
  }

  return importLines.join("\n");
}

/**
 * Get exports from a file.
 */
export function getExports(content: string): Array<{ name: string; line: number }> {
  const lines = content.split("\n");
  const exports: Array<{ name: string; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line.startsWith("export ")) continue;

    const functionMatch = line.match(/export\s+(?:async\s+)?function\s+(\w+)/);
    const classMatch = line.match(/export\s+class\s+(\w+)/);
    const constMatch = line.match(/export\s+(?:default\s+)?const\s+(\w+)/);
    const namedMatch = line.match(/export\s*\{([^}]+)\}/);

    if (functionMatch) {
      exports.push({ name: functionMatch[1], line: i + 1 });
    } else if (classMatch) {
      exports.push({ name: classMatch[1], line: i + 1 });
    } else if (constMatch) {
      exports.push({ name: constMatch[1], line: i + 1 });
    } else if (namedMatch) {
      const names = namedMatch[1].split(",").map((s) => s.trim());
      for (const name of names) {
        exports.push({ name, line: i + 1 });
      }
    }
  }

  return exports;
}
