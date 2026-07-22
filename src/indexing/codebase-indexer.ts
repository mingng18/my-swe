/**
 * Structured Codebase Indexer
 *
 * Provides AST-level codebase indexing for better agent context using
 * regex-based heuristics (no external AST parser required).  Extracts
 * exported symbols, imports, and builds a cross-reference index that can
 * be formatted into a compact string for agent system prompts.
 */

import { createLogger } from "../utils/logger";
import { readFile, stat, readdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const logger = createLogger("codebase-indexer");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SymbolInfo {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable" | "enum";
  filePath: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  signature?: string;
  imports: string[];
  importedBy: string[];
}

export interface FileIndex {
  filePath: string;
  symbols: SymbolInfo[];
  imports: string[];
  exports: string[];
  lastModified: number;
}

export interface CodebaseIndex {
  files: Map<string, FileIndex>;
  symbolIndex: Map<string, SymbolInfo[]>;
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Regex patterns for extraction
// ---------------------------------------------------------------------------

const RE_EXPORT_FUNCTION =
  /export\s+(?:async\s+)?function\s+(\w+)\s*([^{}]*?)\{/g;
const RE_EXPORT_CLASS = /export\s+(?:abstract\s+)?class\s+(\w+)\s*([^{]*?)\{/g;
const RE_EXPORT_INTERFACE = /export\s+interface\s+(\w+)\s*([^{]*?)\{/g;
const RE_EXPORT_TYPE = /export\s+type\s+(\w+)\s*=\s*([^;]+);/g;
const RE_EXPORT_ENUM = /export\s+(?:const\s+)?enum\s+(\w+)\s*\{/g;
const RE_EXPORT_VAR = /export\s+(?:const|let|var)\s+(\w+)\s*[:=]/g;

const RE_NAMED_EXPORT = /export\s*\{([^}]+)\}/g;
const RE_EXPORT_ALL = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
const RE_DEFAULT_EXPORT =
  /export\s+default\s+(?:function|class|const|let|var)\s+(\w+)/g;

const RE_IMPORT =
  /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s*(?:,\s*\{([^}]+)\})?\s*from\s+['"]([^'"]+)['"]/g;
const RE_SIDE_EFFECT_IMPORT = /import\s+['"]([^'"]+)['"]/g;

// Directories to always skip during indexing
const DEFAULT_EXCLUDE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
];

// Extensions to index
const INDEXABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// ---------------------------------------------------------------------------
// CodebaseIndexer
// ---------------------------------------------------------------------------

export class CodebaseIndexer {
  private fileCache: Map<string, FileIndex> = new Map();
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /**
   * Parse a single TypeScript/JavaScript file and extract its exported
   * symbols, imports, and export statements.
   */
  async indexFile(filePath: string): Promise<FileIndex> {
    const absPath = filePath.startsWith("/") ? filePath : filePath;

    // Check cache freshness
    try {
      const st = await stat(absPath);
      const cached = this.fileCache.get(absPath);
      if (cached && cached.lastModified === st.mtimeMs) {
        return cached;
      }
    } catch {
      // File might not exist; return empty index
      logger.warn({ filePath: absPath }, "File not found for indexing");
      return {
        filePath: absPath,
        symbols: [],
        imports: [],
        exports: [],
        lastModified: 0,
      };
    }

    let content: string;
    try {
      content = await readFile(absPath, "utf-8");
    } catch {
      return {
        filePath: absPath,
        symbols: [],
        imports: [],
        exports: [],
        lastModified: 0,
      };
    }

    const lines = content.split("\n");
    const symbols: SymbolInfo[] = [];
    const imports: string[] = [];
    const exports: string[] = [];

    // -- Extract symbols ------------------------------------------------

    this.extractSymbols(
      RE_EXPORT_FUNCTION,
      "function",
      content,
      lines,
      absPath,
      symbols,
      exports,
    );
    this.extractSymbols(
      RE_EXPORT_CLASS,
      "class",
      content,
      lines,
      absPath,
      symbols,
      exports,
    );
    this.extractSymbols(
      RE_EXPORT_INTERFACE,
      "interface",
      content,
      lines,
      absPath,
      symbols,
      exports,
    );
    this.extractSymbols(
      RE_EXPORT_TYPE,
      "type",
      content,
      lines,
      absPath,
      symbols,
      exports,
    );
    this.extractSymbols(
      RE_EXPORT_ENUM,
      "enum",
      content,
      lines,
      absPath,
      symbols,
      exports,
    );
    this.extractExportedVars(content, lines, absPath, symbols, exports);

    // Named re-exports: export { Foo, Bar }
    this.extractNamedExports(content, exports);

    // Default exports
    this.extractDefaultExports(content, lines, absPath, symbols, exports);

    // -- Extract imports ------------------------------------------------

    this.extractImports(content, imports);

    // -- Build FileIndex ------------------------------------------------

    let mtime = 0;
    try {
      const st = await stat(absPath);
      mtime = st.mtimeMs;
    } catch {
      // ignore
    }

    const fileIndex: FileIndex = {
      filePath: absPath,
      symbols,
      imports,
      exports,
      lastModified: mtime,
    };

    this.fileCache.set(absPath, fileIndex);
    return fileIndex;
  }

  /**
   * Recursively index all .ts/.tsx/.js files in a directory and build the
   * full symbol table and cross-reference (importedBy).
   */
  async indexDirectory(
    dir: string,
    exclude: string[] = [],
  ): Promise<CodebaseIndex> {
    const allExclude = new Set([...DEFAULT_EXCLUDE, ...exclude]);
    const files = new Map<string, FileIndex>();
    const symbolIndex = new Map<string, SymbolInfo[]>();

    logger.info({ dir }, "Starting directory indexing");

    const filePaths = await this.discoverFiles(dir, allExclude);

    const CHUNK_SIZE = 50;
    for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (fp) => {
          try {
            const fileIndex = await this.indexFile(fp);
            files.set(fp, fileIndex);
          } catch (error) {
            logger.warn({ filePath: fp, error }, "Failed to index file");
          }
        }),
      );
    }

    // Build symbol index after all files are indexed
    for (const fileIndex of files.values()) {
      for (const sym of fileIndex.symbols) {
        const existing = symbolIndex.get(sym.name) ?? [];
        existing.push(sym);
        symbolIndex.set(sym.name, existing);
      }
    }

    // Build importedBy reverse index
    this.buildImportedBy(files);

    logger.info(
      { dir, fileCount: files.size, symbolCount: symbolIndex.size },
      "Directory indexing complete",
    );

    return {
      files,
      symbolIndex,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Search for symbols by name (fuzzy match).
   */
  search(query: string, index: CodebaseIndex): SymbolInfo[] {
    const lowerQuery = query.toLowerCase();
    const results: SymbolInfo[] = [];

    // Exact match first
    const exact = index.symbolIndex.get(query);
    if (exact) {
      results.push(...exact);
    }

    // Fuzzy (case-insensitive substring) match
    for (const [name, syms] of index.symbolIndex) {
      if (name.toLowerCase().includes(lowerQuery) && name !== query) {
        results.push(...syms);
      }
    }

    return results;
  }

  /**
   * Returns an approximate call graph: symbol -> symbols it references
   * (based on imports and file-level symbol resolution).
   */
  getCallGraph(index: CodebaseIndex): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const [, fileIdx] of index.files) {
      // Map imported module paths to their exported symbols
      const importedSymbols = new Map<string, string[]>();

      for (const imp of fileIdx.imports) {
        const resolved = this.resolveImportPath(imp, fileIdx.filePath, index);
        const targetFile = index.files.get(resolved);
        if (targetFile) {
          importedSymbols.set(imp, targetFile.exports);
        }
      }

      // For each symbol in this file, its "calls" are all symbols from
      // imported modules (conservative approximation).
      const allImportedSymbols: string[] = [];
      for (const syms of importedSymbols.values()) {
        allImportedSymbols.push(...syms);
      }

      for (const sym of fileIdx.symbols) {
        graph.set(sym.name, [...new Set(allImportedSymbols)]);
      }
    }

    return graph;
  }

  /**
   * Format the index into a compact string suitable for injection into
   * an agent system prompt.  Hierarchical: file → exports → signatures.
   */
  formatForAgentContext(index: CodebaseIndex, maxTokens?: number): string {
    const lines: string[] = ["# Codebase Index", ""];

    const sortedFiles = [...index.files.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );

    for (const [absPath, fileIdx] of sortedFiles) {
      const relPath = relative(this.rootDir, absPath);
      const exportedSyms = fileIdx.symbols.filter((s) => s.exported);

      if (exportedSyms.length === 0 && fileIdx.exports.length === 0) continue;

      lines.push(`## ${relPath}`);

      if (fileIdx.exports.length > 0) {
        lines.push(`  exports: ${fileIdx.exports.join(", ")}`);
      }

      for (const sym of exportedSyms) {
        const sig = sym.signature
          ? sym.signature.replace(/\s+/g, " ").trim()
          : "";
        if (sig) {
          lines.push(`  ${sym.kind} ${sym.name}: ${sig}`);
        } else {
          lines.push(`  ${sym.kind} ${sym.name}`);
        }
      }

      lines.push("");
    }

    const result = lines.join("\n");

    // Rough token estimation: ~4 chars per token
    if (maxTokens) {
      const maxChars = maxTokens * 4;
      if (result.length > maxChars) {
        return result.substring(0, maxChars) + "\n... (truncated)";
      }
    }

    return result;
  }

  // -------------------------------------------------------------------
  // Internal helpers – symbol extraction
  // -------------------------------------------------------------------

  private extractSymbols(
    regex: RegExp,
    kind: SymbolInfo["kind"],
    content: string,
    lines: string[],
    filePath: string,
    symbols: SymbolInfo[],
    exports: string[],
  ): void {
    let match: RegExpExecArray | null;
    // Clone regex to avoid issues with /g state
    const re = new RegExp(regex.source, regex.flags);

    while ((match = re.exec(content)) !== null) {
      const name = match[1];
      const signature = match[2]?.trim() || undefined;
      const lineStart = this.lineFromOffset(content, match.index);
      const lineEnd = this.findBlockEnd(lines, lineStart);

      symbols.push({
        name,
        kind,
        filePath,
        lineStart,
        lineEnd,
        exported: true,
        signature,
        imports: [],
        importedBy: [],
      });

      if (!exports.includes(name)) {
        exports.push(name);
      }
    }
  }

  private extractExportedVars(
    content: string,
    lines: string[],
    filePath: string,
    symbols: SymbolInfo[],
    exports: string[],
  ): void {
    const re = new RegExp(RE_EXPORT_VAR.source, RE_EXPORT_VAR.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(content)) !== null) {
      const name = match[1];
      const lineStart = this.lineFromOffset(content, match.index);

      // Skip if already captured (e.g., enum that also matched var pattern)
      if (symbols.some((s) => s.name === name)) continue;

      const lineText = lines[lineStart - 1] ?? "";
      const signature = lineText.trim();

      symbols.push({
        name,
        kind: "variable",
        filePath,
        lineStart,
        lineEnd: lineStart,
        exported: true,
        signature,
        imports: [],
        importedBy: [],
      });

      if (!exports.includes(name)) {
        exports.push(name);
      }
    }
  }

  private extractNamedExports(content: string, exports: string[]): void {
    const re = new RegExp(RE_NAMED_EXPORT.source, RE_NAMED_EXPORT.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(content)) !== null) {
      // ⚡ Bolt: Replaced chained .map().filter() with a single-pass loop to reduce memory allocations and GC pressure.
      const rawNames = match[1].split(",");
      const names: string[] = [];
      for (const s of rawNames) {
        const trimmed = s.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+as\s+/);
        const finalName = parts[parts.length - 1].trim();
        if (finalName) {
          names.push(finalName);
        }
      }

      for (const name of names) {
        if (!exports.includes(name)) {
          exports.push(name);
        }
      }
    }
  }

  private extractDefaultExports(
    content: string,
    lines: string[],
    filePath: string,
    symbols: SymbolInfo[],
    exports: string[],
  ): void {
    const re = new RegExp(RE_DEFAULT_EXPORT.source, RE_DEFAULT_EXPORT.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(content)) !== null) {
      const name = match[1];
      const lineStart = this.lineFromOffset(content, match.index);

      // Only add if not already captured as a specific kind
      if (symbols.some((s) => s.name === name)) {
        if (!exports.includes("default")) exports.push("default");
        continue;
      }

      symbols.push({
        name,
        kind: "variable",
        filePath,
        lineStart,
        lineEnd: lineStart,
        exported: true,
        signature: "default export",
        imports: [],
        importedBy: [],
      });

      if (!exports.includes("default")) exports.push("default");
    }
  }

  // -------------------------------------------------------------------
  // Internal helpers – import extraction
  // -------------------------------------------------------------------

  private extractImports(content: string, imports: string[]): void {
    const seen = new Set<string>();

    // Named and default imports: import { A, B } from 'x'
    const re = new RegExp(RE_IMPORT.source, RE_IMPORT.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(content)) !== null) {
      const modulePath = match[4];
      if (modulePath && !seen.has(modulePath)) {
        imports.push(modulePath);
        seen.add(modulePath);
      }
    }

    // Side-effect imports: import 'x'
    const reSide = new RegExp(
      RE_SIDE_EFFECT_IMPORT.source,
      RE_SIDE_EFFECT_IMPORT.flags,
    );
    while ((match = reSide.exec(content)) !== null) {
      const modulePath = match[1];
      if (modulePath && !seen.has(modulePath)) {
        imports.push(modulePath);
        seen.add(modulePath);
      }
    }

    // Re-exports: export * from 'x'
    const reAll = new RegExp(RE_EXPORT_ALL.source, RE_EXPORT_ALL.flags);
    while ((match = reAll.exec(content)) !== null) {
      const modulePath = match[1];
      if (modulePath && !seen.has(modulePath)) {
        imports.push(modulePath);
        seen.add(modulePath);
      }
    }
  }

  // -------------------------------------------------------------------
  // Internal helpers – cross-reference
  // -------------------------------------------------------------------

  private buildImportedBy(files: Map<string, FileIndex>): void {
    // For each file's imports, find the target file and add to
    // importedBy on its symbols.
    for (const [filePath, fileIdx] of files) {
      for (const imp of fileIdx.imports) {
        const resolvedPath = this.resolveImportPathRaw(imp, filePath, files);
        if (!resolvedPath) continue;

        const targetFile = files.get(resolvedPath);
        if (!targetFile) continue;

        for (const sym of targetFile.symbols) {
          if (sym.exported) {
            sym.importedBy.push(filePath);
          }
        }
      }
    }
  }

  private resolveImportPath(
    importPath: string,
    fromFilePath: string,
    index: CodebaseIndex,
  ): string {
    // Try to resolve the import to an absolute file path
    const candidates = this.getCandidatePaths(importPath, fromFilePath);
    for (const candidate of candidates) {
      if (index.files.has(candidate)) return candidate;
    }
    return importPath; // fallback: return as-is
  }

  private resolveImportPathRaw(
    importPath: string,
    fromFilePath: string,
    files: Map<string, FileIndex>,
  ): string | null {
    const candidates = this.getCandidatePaths(importPath, fromFilePath);
    for (const candidate of candidates) {
      if (files.has(candidate)) return candidate;
    }
    return null;
  }

  private getCandidatePaths(
    importPath: string,
    fromFilePath: string,
  ): string[] {
    const candidates: string[] = [];

    // Relative imports
    if (importPath.startsWith(".")) {
      const dir = fromFilePath.substring(0, fromFilePath.lastIndexOf("/"));
      const base = join(dir, importPath);
      candidates.push(
        base + ".ts",
        base + ".tsx",
        base + ".js",
        base + ".jsx",
        join(base, "index.ts"),
        join(base, "index.tsx"),
        join(base, "index.js"),
      );
    }

    return candidates;
  }

  // -------------------------------------------------------------------
  // Internal helpers – file discovery
  // -------------------------------------------------------------------

  private async discoverFiles(
    dir: string,
    exclude: Set<string>,
  ): Promise<string[]> {
    const results: string[] = [];

    async function walk(currentDir: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (exclude.has(entry.name)) continue;

        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (
          entry.isFile() &&
          INDEXABLE_EXTENSIONS.has(extname(entry.name))
        ) {
          results.push(fullPath);
        }
      }
    }

    await walk(dir);
    return results;
  }

  // -------------------------------------------------------------------
  // Internal helpers – text utilities
  // -------------------------------------------------------------------

  private lineFromOffset(content: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content[i] === "\n") line++;
    }
    return line;
  }

  private findBlockEnd(lines: string[], startLine: number): number {
    // Simple brace-matching heuristic for finding the end of a block.
    let depth = 0;
    let foundOpen = false;

    for (let i = startLine - 1; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === "{") {
          depth++;
          foundOpen = true;
        } else if (ch === "}") {
          depth--;
        }
      }
      if (foundOpen && depth <= 0) {
        return i + 1; // 1-indexed
      }
    }

    // Fallback: estimate ~20 lines per block
    return Math.min(startLine + 20, lines.length);
  }
}
