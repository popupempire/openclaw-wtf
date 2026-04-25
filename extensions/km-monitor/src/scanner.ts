/**
 * km-monitor/src/scanner.ts
 *
 * Conversation Scanner — polls configured LLM interface adapters for new
 * conversations and returns only those not yet seen by the monitor.
 *
 * Each "adapter" is a lightweight async function that fetches the latest
 * conversations from a specific source. Adapters are pluggable: add a new
 * function and register it in `createAdapters()`.
 */

import type { ConversationRecord, ConversationSource } from "./types.js";
import type { MonitorState } from "./types.js";

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface ConversationAdapter {
  /** Human-readable name for logging. */
  name: string;
  /** The source identifier this adapter covers. */
  source: ConversationSource;
  /**
   * Fetch the latest conversations from this source.
   * Returns an empty array if nothing new is available.
   */
  fetchLatest(sinceId?: string): Promise<ConversationRecord[]>;
}

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

/**
 * Custom Webhook Adapter
 *
 * Reads conversations from a local webhook buffer file written by an external
 * process (e.g., a small Express server that receives POST payloads from
 * ChatGPT, Claude.ai, or any other LLM interface via browser extension or
 * API hook). The buffer file is a newline-delimited JSON file.
 *
 * Buffer file path: `~/.openclaw/km-monitor/webhook-buffer.ndjson`
 * (override with `KM_MONITOR_WEBHOOK_BUFFER` env var)
 */
export function createWebhookBufferAdapter(): ConversationAdapter {
  return {
    name: "Webhook Buffer Adapter",
    source: "custom-webhook",
    async fetchLatest(sinceId?: string): Promise<ConversationRecord[]> {
      const { existsSync, readFileSync, writeFileSync } = await import(
        "node:fs"
      );
      const { join } = await import("node:path");

      const home = process.env.HOME ?? "/tmp";
      const bufferPath =
        process.env.KM_MONITOR_WEBHOOK_BUFFER ??
        join(home, ".openclaw", "km-monitor", "webhook-buffer.ndjson");

      if (!existsSync(bufferPath)) return [];

      const lines = readFileSync(bufferPath, "utf-8")
        .split("\n")
        .filter(Boolean);

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
        const remaining = lines
          .filter((l) => !consumed.includes(l))
          .join("\n");
        writeFileSync(bufferPath, remaining ? remaining + "\n" : "", "utf-8");
      }

      return entries;
    },
  };
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

/** Factory: create the default set of adapters. */
export function createAdapters(): ConversationAdapter[] {
  return [createOpenClawSessionAdapter(), createWebhookBufferAdapter()];
}
