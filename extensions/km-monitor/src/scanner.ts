/**
 * km-monitor/src/scanner.ts
 *
 * Conversation Scanner — polls configured LLM interface adapters for new
 * conversations and returns only those not yet seen by the monitor.
 *
 * Each "adapter" is a lightweight async function that fetches the latest
 * conversations from a specific source. Adapters are pluggable: add a new
 * function and register it in `createAdapters()`.
 *
 * Enhanced in v1.1.0:
 *   - Added explicit named adapters for ChatGPT, Claude, Gemini, Mistral, and Meta Llama.
 *     These read from source-specific sub-buffers, enabling per-source deduplication.
 *   - Added `createAllAdapters()` factory for full multi-LLM coverage.
 *   - Added `ADAPTER_DISPLAY_NAMES` map for human-readable source labels.
 *   - Extracted `readAndClearBuffer()` helper to reduce duplication.
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
  "cohere": "Cohere",
  "openclaw-session": "OpenClaw Session",
  "custom-webhook": "Custom Webhook",
};

// ---------------------------------------------------------------------------
// Built-in Adapters
// ---------------------------------------------------------------------------

/**
 * OpenClaw Session Adapter
 *
 * Scans the local OpenClaw session transcript files under
 * `~/.openclaw/sessions/` for new agent conversations.
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
        // Skip sessions we have already processed.
        if (sinceId && dir <= sinceId) continue;

        const transcriptPath = join(sessionsDir, dir, "transcript.json");
        if (!existsSync(transcriptPath)) continue;

        try {
          const raw = readFileSync(transcriptPath, "utf-8");
          const transcript = JSON.parse(raw) as Array<{
            role: string;
            content: string;
          }>;

          // Concatenate all messages into a single text blob for analysis.
          const content = transcript
            .map((m) => `[${m.role}]: ${m.content}`)
            .join("\n");

          entries.push({
            id: dir,
            source: "openclaw-session",
            detectedAt: new Date().toISOString(),
            content,
            originUrl: undefined,
            metadata: { sessionDir: dir },
          });
        } catch {
          // Malformed transcript — skip silently.
        }
      }

      return entries;
    },
  };
}

// ---------------------------------------------------------------------------
// Webhook Buffer Helper
// ---------------------------------------------------------------------------

/**
 * Read and consume NDJSON records from a buffer file.
 * Returns all records with id > sinceId (if provided), and clears consumed
 * lines from the buffer file to prevent re-processing.
 */
async function readAndClearBuffer(
  bufferPath: string,
  sinceId?: string,
): Promise<ConversationRecord[]> {
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  if (!existsSync(bufferPath)) return [];
  const lines = readFileSync(bufferPath, "utf-8").split("\n").filter(Boolean);
  const entries: ConversationRecord[] = [];
  const consumed: string[] = [];
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as ConversationRecord;
      if (sinceId && record.id <= sinceId) continue;
      entries.push(record);
      consumed.push(line);
    } catch {
      // Malformed line — skip.
    }
  }
  // Clear consumed entries from the buffer.
  if (consumed.length > 0) {
    const remaining = lines.filter((l) => !consumed.includes(l)).join("\n");
    writeFileSync(bufferPath, remaining ? remaining + "\n" : "", "utf-8");
  }
  return entries;
}

/**
 * Custom Webhook Adapter (generic catch-all)
 *
 * Reads conversations from the generic webhook buffer file written by the
 * webhook server (`src/webhook-server.ts`). Handles payloads from any LLM
 * interface that does not have a dedicated named adapter.
 *
 * Buffer file: `~/.openclaw/km-monitor/webhook-buffer.ndjson`
 * (override with `KM_MONITOR_WEBHOOK_BUFFER` env var)
 */
export function createWebhookBufferAdapter(): ConversationAdapter {
  return {
    name: "Webhook Buffer Adapter",
    source: "custom-webhook",
    async fetchLatest(sinceId?: string): Promise<ConversationRecord[]> {
      const { join } = await import("node:path");
      const home = process.env.HOME ?? "/tmp";
      const bufferPath =
        process.env.KM_MONITOR_WEBHOOK_BUFFER ??
        join(home, ".openclaw", "km-monitor", "webhook-buffer.ndjson");
      return readAndClearBuffer(bufferPath, sinceId);
    },
  };
}

// ---------------------------------------------------------------------------
// Named LLM Adapters (source-specific webhook sub-buffers)
// ---------------------------------------------------------------------------

/**
 * Factory for creating a named LLM adapter that reads from a source-specific
 * sub-buffer file under the KM directory.
 *
 * The webhook server routes payloads to source-specific buffers when the
 * `source` field in the payload matches a known LLM interface name, enabling
 * per-source deduplication and traceability.
 *
 * Buffer file: `~/.openclaw/km-monitor/buffer-<source>.ndjson`
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

/**
 * ChatGPT Adapter
 *
 * Monitors conversations pushed from OpenAI ChatGPT via the webhook server.
 * Configure your browser extension or API hook to POST to
 * `http://localhost:7842/ingest` with `"source": "openai-chatgpt"`.
 */
export function createChatGPTAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("ChatGPT Adapter", "openai-chatgpt");
}

/**
 * Claude Adapter
 *
 * Monitors conversations pushed from Anthropic Claude via the webhook server.
 * Configure your browser extension or API hook to POST to
 * `http://localhost:7842/ingest` with `"source": "anthropic-claude"`.
 */
export function createClaudeAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Claude Adapter", "anthropic-claude");
}

/**
 * Gemini Adapter
 *
 * Monitors conversations pushed from Google Gemini via the webhook server.
 * Configure your browser extension or API hook to POST to
 * `http://localhost:7842/ingest` with `"source": "google-gemini"`.
 */
export function createGeminiAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Gemini Adapter", "google-gemini");
}

/**
 * Mistral Adapter
 *
 * Monitors conversations pushed from Mistral AI via the webhook server.
 * Configure your browser extension or API hook to POST to
 * `http://localhost:7842/ingest` with `"source": "mistral"`.
 */
export function createMistralAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Mistral Adapter", "mistral");
}

/**
 * Meta Llama Adapter
 *
 * Monitors conversations pushed from Meta Llama interfaces via the webhook server.
 * Configure your browser extension or API hook to POST to
 * `http://localhost:7842/ingest` with `"source": "meta-llama"`.
 */
export function createMetaLlamaAdapter(): ConversationAdapter {
  return createNamedLlmAdapter("Meta Llama Adapter", "meta-llama");
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
 * Factory: create the full set of adapters including all named LLM interfaces.
 * Use this when you want per-source deduplication and traceability for
 * ChatGPT, Claude, Gemini, Mistral, and Meta Llama conversations.
 * Set `KM_MONITOR_ALL_ADAPTERS=1` to activate this set automatically.
 */
export function createAllAdapters(): ConversationAdapter[] {
  return [
    createOpenClawSessionAdapter(),
    createChatGPTAdapter(),
    createClaudeAdapter(),
    createGeminiAdapter(),
    createMistralAdapter(),
    createMetaLlamaAdapter(),
    createWebhookBufferAdapter(), // catch-all for unknown sources
  ];
}
