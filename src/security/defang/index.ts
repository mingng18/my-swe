/**
 * Untrusted-Content Defang.
 *
 * Public entry point for the #489 trust-boundary layer. Every externally-sourced
 * blob that will reach the model (GitHub issue/PR bodies, foreign
 * `CLAUDE.md`/`AGENTS.md` files, fetched URL output) should be passed through
 * `defang()` before it is concatenated into a prompt or returned from a tool.
 *
 * Default behavior is NON-DESTRUCTIVE: the original text is preserved verbatim
 * inside a clearly-delimited envelope that tells the model to treat it as data,
 * not instructions. Set `DEFANG_STRIP_INJECTIONS=1` to additionally neutralize
 * a deterministic set of obvious prompt-injection phrases — still inside the
 * envelope, still labeled as data.
 *
 * Design goals (see docs/roadmap.md P0-2):
 *  - Defense in depth against the Miasma-worm class of config/issue-body
 *    injection attacks on coding agents.
 *  - Never drop information the model needs; only change how it is framed.
 *  - Cheap, synchronous, dependency-free, fully unit-tested.
 */

export {
  buildUntrustedEnvelope,
  sanitizeEnvelopeTags,
  UNTRUSTED_DATA_OPEN_TAG,
  UNTRUSTED_DATA_CLOSE_TAG,
  UNTRUSTED_DATA_PREAMBLE,
  NEUTRALIZED_OPEN_TAG,
  NEUTRALIZED_CLOSE_TAG,
  type UntrustedSource,
} from "./envelope";

import { buildUntrustedEnvelope, type UntrustedSource } from "./envelope";

/**
 * Whether to additionally neutralize obvious injection phrases inside the
 * envelope. Off by default (the envelope itself is the primary defense).
 * Read at call time so tests and runtime can toggle it without a re-import.
 */
export function stripInjectionsEnabled(): boolean {
  return process.env.DEFANG_STRIP_INJECTIONS === "1";
}

/**
 * Deterministic, conservative set of injection phrases. Each entry is matched
 * case-insensitively as a substring and replaced with a visible placeholder.
 *
 * This is intentionally a SMALL list of high-confidence patterns. The envelope
 * is the primary defense; stripping is a bonus heuristic and is off by
 * default. False positives (mangling benign text) are worse than false
 * negatives (letting a phrase through), so we only match phrases that have no
 * legitimate reason to appear in a code/issue body addressed to the agent.
 */
const INJECTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // "Ignore all previous instructions" and common variants.
  {
    pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions?/gi,
    replacement: "[blocked-injection-phrase:ignore-instructions]",
  },
  // "You are now ..." / "act as a new ..." role-reset attempts.
  {
    pattern: /you\s+are\s+now\s+(?:a|an)\s+new\s+/gi,
    replacement: "[blocked-injection-phrase:role-reset]",
  },
  // "Disregard everything above".
  {
    pattern: /disregard\s+(?:everything|all)\s+(?:above|before|prior|previous)/gi,
    replacement: "[blocked-injection-phrase:disregard]",
  },
  // "Do not follow your rules".
  {
    pattern: /do\s+not\s+follow\s+(?:your|the|any)\s+rules/gi,
    replacement: "[blocked-injection-phrase:ignore-rules]",
  },
  // Dangerous shell one-liners commonly used in worm payloads.
  {
    pattern: /rm\s+-rf\s+[/~]/gi,
    replacement: "[blocked-injection-phrase:destructive-command]",
  },
];

/**
 * Apply the optional heuristic injection-phrase neutralization to `text`.
 *
 * Non-destructive in spirit: phrases are replaced with visible `[blocked-...]`
 * placeholders rather than deleted, so a reviewer (or the model itself) can see
 * that an injection attempt was caught.
 */
export function stripInjectionPhrases(text: string): string {
  let result = text;
  for (const { pattern, replacement } of INJECTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Defang a piece of externally-sourced text before it reaches the model.
 *
 * Wraps `text` in the untrusted-data envelope (always) and, when
 * `DEFANG_STRIP_INJECTIONS=1` is set, additionally neutralizes obvious
 * injection phrases. The original text is preserved inside the envelope
 * regardless.
 *
 * @param source - The trust boundary the text crossed.
 * @param text - Raw external text. Empty/null/undefined inputs are returned
 *   unchanged (an empty envelope would just add noise).
 * @returns The defanged string, safe to concatenate into a prompt or tool
 *   result.
 */
export function defang(source: UntrustedSource, text: string | null | undefined): string {
  if (!text) {
    return text ?? "";
  }
  const payload = stripInjectionsEnabled() ? stripInjectionPhrases(text) : text;
  return buildUntrustedEnvelope(source, payload);
}
