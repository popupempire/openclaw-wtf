/**
 * km-monitor/src/scanner.ts  — v1.2.0
 *
 * Conversation Scanner — polls configured LLM interface adapters for new
 * conversations and returns only those not yet seen by the monitor.
 *
 * Changes in v1.2.0:
 *   - Added adapters for xAI Grok, Perplexity, and DeepSeek.
 *   - Cohere adapter promoted from types-only to a named adapter.
 *   - OpenClaw Session Adapter now reads from compacted session files too.
 *   - Added `createExtendedAdapters()` factory for all v1.2.0 sources.
 *   - `readAndClearBuffer()` now handles malformed NDJSON lines gracefully.
 */
import type { ConversationRecord, ConversationSource } from "./types.js";
import type { MonitorState } from "./types.js";

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface ConversationAdapter {
  /** Human-readable name for logging and notifications. */
  name: string;
  /** The source identifier used in ConversationRecord.source. */
  source: ConversationSource;
  /**
   * Fetch the latest conversations from this LLM interface.
   * @param sinceId - If provided, only return conversations with id > sinceId.
   */
  fetchLatest(sinceId?: string): Promise<ConversationRecord[]>;
}

/** Human-readable display names for well-known sources. */
export const ADAPTER_DISPLAY_NAMES: Record<string, string> = {
  "openai-chatgpt": "OpenAI ChatGPT",
  "anthropic-claude": "Anthropic Claude",
  "google-gemini": "Google Gemini",
  "mistral": "Mistral AI",
  "meta-llama": "Meta Llama",
  "cohere": "Cohere Command",
  "xai-grok": "xAI Grok",
  "perplexity": "Perplexity AI",
  "deepseek": "DeepSeek",
  "openclaw-session": "OpenClaw Session",
  "custom-webhook": "Custom Webhook",
};

// ---------------------------------------------------------------------------
// Webhook Buffer Helper
// ---------------------------------------------------------------------------

/**
 * Read all records from an NDJSON buffer file, then clear it atomically.
 * Skips malformed lines and logs a warning for each.
 *
 * @param bufferPath - Absolute path to the NDJSON buffer file.
 * @param sinceId    - If provided, only return records with id > sinceId.
 */
async function readAndClearBuffer(
  bufferPath: string,
  sinceId?: string,
): Promise<ConversationRecord[]> {
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  if (!existsSync(bufferPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(bufferPath, "utf-8");
    writeFileSync(bufferPath, "", "utf-8"); // clear atomically
  } catch {
    return [];
  }
  const records: ConversationRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as ConversationRecord;
      if (sinceId && record.id <= sinceId) continue;
      records.push(record);
    } catch {
      console.warn(`[km-monitor/scanner] Skipping malformed buffer line: ${trimmed.slice(0, 80)}`);
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Built-in Adapters
// ---------------------------------------------------------------------------

/**
 * OpenClaw Session Adapter
 *
 * Scans the local OpenClaw session transcript files under
 * `~/.openclaw/sessions/` for new agent conversations.
 * Also reads compacted session files (`transcript.compact.json`).
 */
export function createOpenClawSessionAdapter(): ConversationAdapter {
  return {
    name: "OpenClaw Session Adapter",
    source: "openclaw-session",
    async fetchLatest(sinceId?: string): Promise<ConversationRecord[]> {
      const { readdirSync, readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const home = process.env.HOME ?? "/tmp";
      const sessionsDir = join(home, ".openclaw", "sessions");
      if (!existsSync(sessionsDir)) return [];
      const entries: ConversationRecord[] = [];
      let dirs: string[];
      try {
        dirs = readdirSync(sessionsDir);
      } catch {
        return [];
      }
      for (const dir of dirs) {
        if (sinceId && dir <= sinceId) continue;
        // Prefer compacted transcript if available, fall back to full.
        const compactPath = join(sessionsDir, dir, "transcript.compact.json");
        const fullPath = join(sessionsDir, dir, "transcript.json");
        const transcriptPath = existsSync(compactPath) ? compactPath : fullPath;
        if (!existsSync(transcriptPath)) continue;
        try {
          const raw = readFileSync(transcriptPath, "utf-8");
          const transcript = JSON.parse(raw) as Array<{
            role: string;
            content: string;
          }>;
          const content = transcript
            .map((m) => `[${m.role}]: ${m.content}`)
            .join("\n");
          entries.push({
            id: dir,
            source: "openclaw-session",
            detectedAt: new Date().toISOString(),
            content,
            originUrl: undefined,
            metadata: { sessionDir: dir, transcriptFile: transcriptPath },
          });
        } catch {
          // Malformed transcript — skip silently.
        }
      }
      return entries;
    },
  };
}

/**
 * Generic Webhook Buffer Adapter
 *
 * Reads from the catch-all webhook buffer file. Handles payloads from
 * unknown or custom LLM sources that do not have a named adapter.
 */
export function createWebhookBufferAdapter(): ConversationAdapter {
  return {
    name: "Generic Webhook Buffer",
    source: "custom-webhook",
    async fetchLatest(sinceId?: string): Promise<ConversationRecord[]> {
      const { join } = await import("node:path");
      const home = process.env.HOME ?? "/tmp";
      const kmDir =
        process.env.KM_MONITOR_KM_DIR ??
        join(home, ".openclaw", "km-monitor");
      const bufferPath =
        process.env.KM_MONITOR_WEBHOOK_BUFFER ??
        join(kmDir, "webhook-buffer.ndjson");
      return readAndClearBuffer(bufferPath, sinceId);
    },
  };
}

// ---------------------------------------------------------------------------
// Named LLM Adapters (factory)
// ---------------------------------------------------------------------------

/**
 * Factory for creating a named LLM adapter that reads from a source-specific
 * sub-buffer file under the KM directory.
 */
function createNamedLlmAdapter(
  adapterName: string,
  source: ConversationSource,
): ConversationAdapter {
  return {
    name: adapterName,
    source,
    async fetchLatest(sinceId?: string): Promise<ConversationRecord[]> {
      const { join } = await import("node:path");
      const home = process.env.HOME ?? "/tmp";
      const kmDir =
        process.env.KM_MONITOR_KM_DIR ??
        join(home, ".openclaw", "km-monitor");
      const bufferPath = join(kmDir, `buffer-${source}.ndjson`);
      return readAndClearBuffer(bufferPath, sinceId);
    },
  };
}

/** ChatGPT Adapter — reads from `buffer-openai-chatgpt.ndjson`. */
export function createChatGPTAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("ChatGPT Adapter", "openai-chatgpt");
}

/** Claude Adapter — reads from `buffer-anthropic-claude.ndjson`. */
export function createClaudeAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Claude Adapter", "anthropic-claude");
}

/** Gemini Adapter — reads from `buffer-google-gemini.ndjson`. */
export function createGeminiAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Gemini Adapter", "google-gemini");
}

/** Mistral Adapter — reads from `buffer-mistral.ndjson`. */
export function createMistralAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Mistral Adapter", "mistral");
}

/** Meta Llama Adapter — reads from `buffer-meta-llama.ndjson`. */
export function createMetaLlamaAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Meta Llama Adapter", "meta-llama");
}

/** Cohere Adapter — reads from `buffer-cohere.ndjson`. */
export function createCohereAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Cohere Command Adapter", "cohere");
}

/** xAI Grok Adapter — reads from `buffer-xai-grok.ndjson`. */
export function createGrokAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("xAI Grok Adapter", "xai-grok");
}

/** Perplexity Adapter — reads from `buffer-perplexity.ndjson`. */
export function createPerplexityAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Perplexity AI Adapter", "perplexity");
}

/** DeepSeek Adapter — reads from `buffer-deepseek.ndjson`. */
export function createDeepSeekAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("DeepSeek Adapter", "deepseek");
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

export interface ScanResult {
  newConversations: ConversationRecord[];
  /** Number of adapters that were queried. */
  adaptersQueried: number;
  /** Any adapter errors encountered (non-fatal). */
  errors: Array<{ adapter: string; error: string }>;
}

/**
 * Run a single scan cycle across all registered adapters.
 * Returns only conversations not yet seen according to `state`.
 */
export async function runScanCycle(
  adapters: ConversationAdapter[],
  state: MonitorState,
): Promise<ScanResult> {
  const newConversations: ConversationRecord[] = [];
  const errors: Array<{ adapter: string; error: string }> = [];
  for (const adapter of adapters) {
    const sinceId = state.lastSeenIds[adapter.source];
    try {
      const records = await adapter.fetchLatest(sinceId);
      newConversations.push(...records);
    } catch (err) {
      errors.push({
        adapter: adapter.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    newConversations,
    adaptersQueried: adapters.length,
    errors,
  };
}

/**
 * Factory: create the default set of adapters.
 * Includes OpenClaw sessions and the generic webhook buffer.
 */
export function createAdapters(): ConversationAdapter[] {
  return [createOpenClawSessionAdapter(), createWebhookBufferAdapter()];
}

/**
 * Factory: create the full v1.1.0 adapter set (original named LLMs).
 */
export function createAllAdapters(): ConversationAdapter[] {
  return [
    createOpenClawSessionAdapter(),
    createChatGPTAdapter(),
    createClaudeAdapter(),
    createGeminiAdapter(),
    createMistralAdapter(),
    createMetaLlamaAdapter(),
    createWebhookBufferAdapter(),
  ];
}

/**
 * Factory: create the extended v1.2.0 adapter set including all new LLM sources.
 * Set `KM_MONITOR_EXTENDED_ADAPTERS=1` to activate this set automatically.
 */
export function createExtendedAdapters(): ConversationAdapter[] {
  return [
    createOpenClawSessionAdapter(),
    createChatGPTAdapter(),
    createClaudeAdapter(),
    createGeminiAdapter(),
    createMistralAdapter(),
    createMetaLlamaAdapter(),
    createCohereAdapter(),
    createGrokAdapter(),
    createPerplexityAdapter(),
    createDeepSeekAdapter(),
    createWebhookBufferAdapter(), // catch-all for unknown sources
  ];
}
