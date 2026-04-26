import {
  detectProvider,
  type LlmProvider,
  type ModelConfig,
} from "./model-factory";

/** Load env for the Telegram bot. Extend as other subsystems are added. */
export function loadTelegramConfig(): {
  telegramBotToken: string;
  telegramAdminChatId?: string;
  telegramParseMode: string;
} {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env and set your bot token from @BotFather.",
    );
  }
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  const parseMode = process.env.TELEGRAM_PARSE_MODE?.trim() || "Markdown";
  return {
    telegramBotToken: token,
    telegramAdminChatId: adminChatId,
    telegramParseMode: parseMode,
  };
}

/** Load exponential backoff configuration for Telegram polling retries. */
export function loadTelegramBackoffConfig(): {
  baseDelayMs: number;
  maxDelayMs: number;
} {
  const baseDelayMsRaw = process.env.TELEGRAM_BACKOFF_BASE_MS;
  const maxDelayMsRaw = process.env.TELEGRAM_BACKOFF_MAX_MS;

  const baseDelayMs =
    baseDelayMsRaw !== undefined
      ? Number.parseInt(baseDelayMsRaw, 10)
      : 1000;
  const maxDelayMs =
    maxDelayMsRaw !== undefined
      ? Number.parseInt(maxDelayMsRaw, 10)
      : 60000;

  // Handle NaN from invalid input
  const finalBaseDelayMs = Number.isNaN(baseDelayMs) ? 1000 : baseDelayMs;
  const finalMaxDelayMs = Number.isNaN(maxDelayMs) ? 60000 : maxDelayMs;

  if (finalBaseDelayMs < 0) {
    throw new Error(
      "TELEGRAM_BACKOFF_BASE_MS must be a non-negative number. Set it in .env (see .env.example).",
    );
  }

  if (finalMaxDelayMs < finalBaseDelayMs) {
    throw new Error(
      "TELEGRAM_BACKOFF_MAX_MS must be greater than or equal to TELEGRAM_BACKOFF_BASE_MS. Set it in .env (see .env.example).",
    );
  }

  return { baseDelayMs: finalBaseDelayMs, maxDelayMs: finalMaxDelayMs };
}

/** Where the linter runs (clone target later; defaults to process cwd). */
export function loadPipelineConfig(): {
  workspaceRoot: string;
  linterCommand: string;
} {
  const workspaceRoot = process.env.WORKSPACE_ROOT?.trim() || process.cwd();
  const linterCommand =
    process.env.LINTER_COMMAND?.trim() || "bunx tsc --noEmit";
  return { workspaceRoot, linterCommand };
}

/** OpenAI-compatible API (OpenAI, OpenRouter, Z.ai, etc.) */
export function loadLlmConfig(): {
  provider: LlmProvider;
  openaiBaseUrl: string;
  openaiApiKey: string;
  model: string;
  googleApiKey?: string;
  fallback?: {
    openaiBaseUrl: string;
    openaiApiKey: string;
    model: string;
  };
} {
  const provider = detectProvider();
  const model = process.env.MODEL?.trim();

  if (!model) {
    throw new Error("Missing MODEL. Set it in .env (see .env.example).");
  }

  // Provider-specific key validation
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const openaiBaseUrl =
    process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const googleApiKey = process.env.GOOGLE_API_KEY?.trim();

  if (provider === "google" && !googleApiKey) {
    throw new Error(
      "LLM_PROVIDER is 'google' but GOOGLE_API_KEY is not set. Set it in .env.",
    );
  }
  if (provider === "openai" && !openaiApiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Set it in .env (see .env.example).",
    );
  }

  const fallbackApiKey = process.env.OPENAI_API_KEY_FALLBACK?.trim();
  const fallbackModel = process.env.MODEL_FALLBACK?.trim();
  const fallbackBaseUrl =
    process.env.OPENAI_BASE_URL_FALLBACK?.trim() || openaiBaseUrl;

  const hasAnyFallback =
    Boolean(fallbackApiKey) ||
    Boolean(fallbackModel) ||
    Boolean(process.env.OPENAI_BASE_URL_FALLBACK?.trim());

  if (hasAnyFallback && (!fallbackApiKey || !fallbackModel)) {
    throw new Error(
      "Fallback LLM config requires both OPENAI_API_KEY_FALLBACK and MODEL_FALLBACK when any fallback variable is set.",
    );
  }

  const fallback =
    fallbackApiKey && fallbackModel
      ? {
          openaiBaseUrl: fallbackBaseUrl,
          openaiApiKey: fallbackApiKey,
          model: fallbackModel,
        }
      : undefined;

  return {
    provider,
    openaiBaseUrl,
    openaiApiKey,
    model,
    googleApiKey,
    fallback,
  };
}

/**
 * Build a `ModelConfig` ready for `createChatModel()` from environment variables.
 * Optionally override with explicit LLM settings (e.g. for fallback switching).
 */
export function loadModelConfig(override?: {
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  model?: string;
}): ModelConfig {
  const llm = loadLlmConfig();
  return {
    provider: override ? "openai" : llm.provider,
    model: override?.model || llm.model,
    openaiApiKey: override?.openaiApiKey || llm.openaiApiKey,
    openaiBaseUrl: override?.openaiBaseUrl || llm.openaiBaseUrl,
    googleApiKey: llm.googleApiKey,
  };
}

/**
 * Validate startup configuration for deployment-critical settings.
 */
export function validateStartupConfig(): void {
  // Validate LLM configuration and optional fallback pairings.
  loadLlmConfig();
}
