/**
 * Provider-neutral sandbox port types owned by this repo.
 *
 * Clean-architecture rule: application code should not import protocol types
 * from an agent SDK (e.g. deepagents). Adapters can implement these ports.
 */
export type ExecuteResponse = {
  output: string;
  exitCode: number;
  truncated?: boolean;
};

export type FileInfo = {
  path: string;
  is_dir: boolean;
};

export type FileData = {
  content: string[];
  created_at: string;
  modified_at: string;
};

export type GrepMatch = {
  path: string;
  line: number;
  text: string;
};

export type WriteResult = { path?: string; error?: string };

export type EditResult = {
  path?: string;
  occurrences?: number;
  filesUpdate?: unknown;
  error?: string;
};

export interface SandboxBackendPort {
  execute(command: string): Promise<ExecuteResponse>;
}

export interface FilesystemPort {
  lsInfo(path: string): Promise<FileInfo[]>;
  read(filePath: string, offset?: number, limit?: number): Promise<string>;
  readRaw(filePath: string): Promise<FileData>;
  grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null,
  ): Promise<GrepMatch[] | string>;
  globInfo(pattern: string, path?: string): Promise<FileInfo[]>;
  write(filePath: string, content: string): Promise<WriteResult>;
  edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult>;
  uploadFiles(files: Array<[string, Uint8Array]>): Promise<
    Array<{
      path: string;
      error:
        | "file_not_found"
        | "permission_denied"
        | "is_directory"
        | "invalid_path"
        | null;
    }>
  >;
  downloadFiles(paths: string[]): Promise<
    Array<{
      path: string;
      content: Uint8Array | null;
      error:
        | "file_not_found"
        | "permission_denied"
        | "is_directory"
        | "invalid_path"
        | null;
    }>
  >;
}

export type SandboxPort = SandboxBackendPort & FilesystemPort & {
  id: string;
  cleanup(): Promise<void>;
};

