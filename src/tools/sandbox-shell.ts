/**
 * Sandbox shell execution tools for DeepAgents.
 *
 * Note: The primary shell execution is handled by the OpenSandboxBackend
 * implementing the SandboxBackendProtocol interface. This tool provides
 * additional utilities and control commands.
 */

import { createLogger } from "../utils/logger";
import { tool } from "langchain";
import { z } from "zod";
import { getSandboxBackendSync } from "../utils/sandboxState";

const logger = createLogger("sandbox-shell-tool");

/**
 * Safely embed an arbitrary string into a POSIX shell command.
 * Produces: 'foo'"'"'bar' style quoting.
 */
function shellEscapeSingleQuotes(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}

function getSandboxBackendFromConfig(config: any): any {
  const threadId = config?.configurable?.thread_id;
  const backend = threadId ? getSandboxBackendSync(threadId) : null;
  logger.debug(
    { threadId, hasBackend: Boolean(backend) },
    "[sandbox-shell] Resolved sandbox backend from config",
  );
  return backend;
}

/**
 * Extended shell command tool with enhanced capabilities.
 */
export const sandboxShellTool = tool(
  async (
    {
      command,
      timeout,
      shell,
    }: {
      command: string;
      timeout?: number;
      shell?: string;
    },
    config,
  ) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug(
      { command, timeout, shell },
      "[sandbox-shell] Executing command",
    );

    try {
      // If a specific shell is requested, prefix the command
      let fullCommand = command;
      if (shell) {
        // Basic validation of shell executable name to prevent injection in the shell parameter itself
        if (!/^[a-zA-Z0-9_./-]+$/.test(shell)) {
          throw new Error(
            "Invalid shell specified. Only alphanumeric characters, dashes, underscores, dots, and forward slashes are allowed.",
          );
        }
        fullCommand = `${shell} -c ${shellEscapeSingleQuotes(command)}`;
      }
      const result = await backend.execute(fullCommand);

      return {
        stdout: result.output,
        exitCode: result.exitCode,
        truncated: result.truncated,
        command: fullCommand,
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-shell] Command failed");
      throw err;
    }
  },
  {
    name: "sandbox_shell",
    description:
      "Execute shell commands in the isolated OpenSandbox environment. " +
      "This provides a secure container with full shell access, filesystem operations, " +
      "and network connectivity (subject to policies). Commands run with standard Linux tools available.",
    schema: z.object({
      command: z.string().describe("The shell command to execute"),
      timeout: z
        .number()
        .optional()
        .default(30000)
        .describe("Timeout in milliseconds (default: 30000)"),
      shell: z
        .string()
        .optional()
        .describe("Specific shell to use (e.g., 'bash', 'sh', 'python3')"),
    }),
  },
);

/**
 * Get sandbox metrics and status information.
 */
export const sandboxMetricsTool = tool(
  async (_args, config) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug("[sandbox-metrics] Getting sandbox info");

    try {
      const info = await backend.getInfo();
      return {
        id: info?.id,
        state: info?.state,
        createdAt: info?.createdAt,
        expiresAt: info?.expiresAt,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-metrics] Failed to get info");
      throw err;
    }
  },
  {
    name: "sandbox_metrics",
    description:
      "Get current sandbox status including state, creation time, expiration, and resource metrics. " +
      "Useful for monitoring sandbox lifecycle and debugging issues.",
    schema: z.object({}),
  },
);

/**
 * Update network egress policy for the sandbox.
 */
export const sandboxNetworkTool = tool(
  async (
    {
      rules,
    }: {
      rules: Array<{ action: "allow" | "deny"; target: string }>;
    },
    config,
  ) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug({ rules }, "[sandbox-network] Updating egress policy");

    try {
      const success = await backend.patchEgressRules(rules);
      return {
        success,
        rules,
        message: success
          ? "Network policy updated successfully"
          : "Failed to update network policy",
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-network] Policy update failed");
      throw err;
    }
  },
  {
    name: "sandbox_network",
    description:
      "Control outbound network access from the sandbox. " +
      "Use this to allow or deny access to specific domains or hosts. " +
      "Rules are merged with existing policy - new rules for a target take priority.",
    schema: z.object({
      rules: z
        .array(
          z.object({
            action: z
              .enum(["allow", "deny"])
              .describe("Whether to allow or deny traffic to this target"),
            target: z
              .string()
              .describe("Domain or host (e.g., 'api.github.com', 'pypi.org')"),
          }),
        )
        .describe("List of network policy rules to apply"),
    }),
  },
);

/**
 * Pause the sandbox to conserve resources.
 */
export const sandboxPauseTool = tool(
  async (_args, config) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug("[sandbox-pause] Pausing sandbox");

    try {
      const success = await backend.pause();
      return {
        success,
        message: success
          ? "Sandbox paused successfully. Use resume to continue."
          : "Failed to pause sandbox",
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-pause] Failed to pause");
      throw err;
    }
  },
  {
    name: "sandbox_pause",
    description:
      "Pause the sandbox to conserve resources when not in use. " +
      "The sandbox can be resumed later with sandbox_resume. " +
      "Useful for long-running sessions with idle periods.",
    schema: z.object({}),
  },
);

/**
 * Resume a paused sandbox.
 */
export const sandboxResumeTool = tool(
  async (_args, config) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug("[sandbox-resume] Resuming sandbox");

    try {
      const resumed = await backend.resume();
      return {
        success: !!resumed,
        message: resumed
          ? "Sandbox resumed successfully"
          : "Failed to resume sandbox",
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-resume] Failed to resume");
      throw err;
    }
  },
  {
    name: "sandbox_resume",
    description:
      "Resume a paused sandbox to continue execution. " +
      "Restores the sandbox to an active state for command execution.",
    schema: z.object({}),
  },
);

/**
 * Renew sandbox timeout to extend its lifetime.
 */
export const sandboxRenewTool = tool(
  async ({ timeoutSeconds }: { timeoutSeconds: number }, config) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug({ timeoutSeconds }, "[sandbox-renew] Renewing sandbox");

    try {
      const success = await backend.renew(timeoutSeconds);
      return {
        success,
        timeoutSeconds,
        message: success
          ? `Sandbox renewed for ${timeoutSeconds} seconds`
          : "Failed to renew sandbox",
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-renew] Failed to renew");
      throw err;
    }
  },
  {
    name: "sandbox_renew",
    description:
      "Extend the sandbox lifetime by renewing its timeout. " +
      "Useful for long-running tasks that exceed the default timeout.",
    schema: z.object({
      timeoutSeconds: z
        .number()
        .describe("New timeout in seconds (e.g., 3600 for 1 hour)"),
    }),
  },
);

/**
 * Get endpoint URL for a sandbox service port.
 */
export const sandboxEndpointTool = tool(
  async ({ port }: { port: number }, config) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug({ port }, "[sandbox-endpoint] Getting endpoint");

    try {
      const url = await backend.getEndpointUrl(port);
      return {
        port,
        url,
        exists: !!url,
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-endpoint] Failed to get endpoint");
      throw err;
    }
  },
  {
    name: "sandbox_endpoint",
    description:
      "Get the public endpoint URL for a service running in the sandbox. " +
      "Useful when the agent starts a web server or other service in the sandbox.",
    schema: z.object({
      port: z.number().describe("The port number to get the endpoint for"),
    }),
  },
);

// Export all sandbox tools
export const sandboxTools = [
  sandboxShellTool,
  sandboxMetricsTool,
  sandboxNetworkTool,
  sandboxPauseTool,
  sandboxResumeTool,
  sandboxRenewTool,
  sandboxEndpointTool,
];
