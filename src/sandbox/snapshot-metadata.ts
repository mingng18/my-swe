/**
 * Snapshot Metadata Types
 *
 * Snapshots are pre-built sandbox environments that can be restored instantly.
 * They are keyed by (repo, profile, branch) to support different language setups.
 *
 * Multi-profile support:
 * - typescript: Node.js + TypeScript environment
 * - javascript: Node.js environment
 * - python: Python environment
 * - java: Java environment
 * - polyglot: Multi-language setup
 *
 * References:
 * - Internal enterprise transformation plan (Phase 2)
 */

import type { SandboxProfile } from "../integrations/daytona-pool";

/**
 * Unique key for a snapshot.
 * Combines repo, profile, and branch to support multiple environments per repo.
 */
export interface SnapshotKey {
  repoOwner: string;
  repoName: string;
  profile: SandboxProfile;
  branch: string;
}

/**
 * Snapshot metadata stored for each snapshot.
 */
export interface SnapshotMetadata {
  /** Unique snapshot identifier */
  snapshotId: string;

  /** Key that identifies this snapshot */
  key: SnapshotKey;

  /** When the snapshot was created */
  createdAt: Date;

  /** When the snapshot was last refreshed */
  refreshedAt: Date;

  /** Git commit SHA this snapshot is based on */
  commitSha: string;

  /** List of dependencies installed */
  dependencies: string[];

  /** Whether pre-build (if applicable) succeeded */
  preBuildSuccess: boolean;

  /** Snapshot size in bytes (diff-based) */
  size: number;

  /** Sandbox provider that created this snapshot */
  provider: "opensandbox" | "daytona";

  /** Image used for the sandbox */
  image: string;

  /** Whether snapshot is currently being refreshed */
  refreshing: boolean;
}

/**
 * Snapshot creation options.
 */
export interface SnapshotOptions {
  /** Profile (language environment) to use */
  profile: SandboxProfile;

  /** Branch to snapshot (default: main/master) */
  branch?: string;

  /** Whether to run pre-build step */
  runPreBuild?: boolean;

  /** Maximum age before refresh is needed (hours) */
  maxAgeHours?: number;

  /** Custom setup commands to run after clone */
  setupCommands?: string[];

  /** Custom dependencies to install */
  dependencies?: string[];
}

/**
 * Snapshot store interface.
 * Can be implemented with different backends (filesystem, S3, database, etc.).
 */
export interface SnapshotStore {
  /** Get snapshot metadata by key */
  get(key: SnapshotKey): Promise<SnapshotMetadata | null>;

  /** Save snapshot metadata */
  save(metadata: SnapshotMetadata): Promise<void>;

  /** List all snapshots for a repo */
  listByRepo(repoOwner: string, repoName: string): Promise<SnapshotMetadata[]>;

  /** List all snapshots for a specific profile */
  listByProfile(key: Omit<SnapshotKey, "branch">): Promise<SnapshotMetadata[]>;

  /** Delete a snapshot */
  delete(key: SnapshotKey): Promise<void>;

  /** Clean up old snapshots beyond max age */
  cleanup(maxAgeHours: number): Promise<number>;

  /** List all snapshots */
  listAll(): Promise<SnapshotMetadata[]>;
}

/**
 * Create a snapshot key from components.
 */
export function createSnapshotKey(params: {
  repoOwner: string;
  repoName: string;
  profile: SandboxProfile;
  branch: string;
}): SnapshotKey {
  return {
    repoOwner: params.repoOwner.toLowerCase(),
    repoName: params.repoName.toLowerCase(),
    profile: params.profile,
    branch: params.branch,
  };
}

/**
 * Create a string key for storage/indexing.
 */
export function snapshotKeyToString(key: SnapshotKey): string {
  return `${key.repoOwner}/${key.repoName}/${key.profile}/${key.branch}`;
}

/**
 * Parse a string key back to SnapshotKey.
 */
export function parseSnapshotKey(key: string): SnapshotKey | null {
  const parts = key.split("/");
  if (parts.length !== 4) return null;

  const [repoOwner, repoName, profile, branch] = parts;
  const validProfiles: SandboxProfile[] = [
    "typescript",
    "javascript",
    "python",
    "java",
    "polyglot",
  ];

  if (!validProfiles.includes(profile as SandboxProfile)) {
    return null;
  }

  return {
    repoOwner,
    repoName,
    profile: profile as SandboxProfile,
    branch,
  };
}

/**
 * Check if a snapshot is expired based on max age.
 */
export function isSnapshotExpired(
  metadata: SnapshotMetadata,
  maxAgeHours: number,
): boolean {
  const ageMs = Date.now() - metadata.refreshedAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return ageHours > maxAgeHours;
}

/**
 * Profile-specific default setup commands.
 */
export const PROFILE_SETUP_COMMANDS: Record<SandboxProfile, string[]> = {
  typescript: ["npm install -g typescript", "npm install -g tsx"],
  javascript: ["npm install -g nodemon"],
  python: ["pip install --upgrade pip", "pip install pytest black mypy pylint"],
  java: ["mvn dependency:resolve"],
  polyglot: [
    // Multi-language setup
    "npm install -g typescript",
    "pip install pytest black",
  ],
};

/**
 * Profile-specific dependency detection files.
 */
export const PROFILE_DEPENDENCY_FILES: Record<SandboxProfile, string[]> = {
  typescript: ["package.json", "tsconfig.json"],
  javascript: ["package.json"],
  python: ["requirements.txt", "pyproject.toml", "setup.py"],
  java: ["pom.xml", "build.gradle"],
  polyglot: ["package.json", "requirements.txt", "pom.xml"],
};

/**
 * Get the default branch for a repo (main or master).
 */
export function getDefaultBranch(): string {
  return "main"; // Most repos use main now
}

/**
 * Detect the appropriate profile from repository files.
 */
export function detectProfileFromFiles(files: string[]): SandboxProfile | null {
  let hasTsConfigOrPackageJson = false;
  let hasTsFiles = false;
  let hasPythonFiles = false;
  let hasJavaFiles = false;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const lowerFile = file.toLowerCase();

    if (lowerFile === "tsconfig.json" || lowerFile === "package.json") {
      hasTsConfigOrPackageJson = true;
    } else if (
      lowerFile === "requirements.txt" ||
      lowerFile === "pyproject.toml" ||
      lowerFile === "setup.py"
    ) {
      hasPythonFiles = true;
    } else if (lowerFile === "pom.xml" || lowerFile === "build.gradle") {
      hasJavaFiles = true;
    }

    if (!hasTsFiles && (file.endsWith(".ts") || file.endsWith(".tsx"))) {
      hasTsFiles = true;
    }
  }

  if (hasTsConfigOrPackageJson) {
    return hasTsFiles ? "typescript" : "javascript";
  }

  if (hasPythonFiles) {
    return "python";
  }

  if (hasJavaFiles) {
    return "java";
  }

  return null;
}
