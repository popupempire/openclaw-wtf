/**
 * km-monitor/src/types.ts  — v1.2.0
 *
 * Shared type definitions for the Knowledge Map Monitor extension.
 * All data flowing through the pipeline is typed here for strict safety.
 *
 * Changes in v1.2.0:
 *   - Added "xai-grok", "perplexity", "deepseek" to ConversationSource.
 *   - Added SyncBatch for multi-conversation batch tracking.
 *   - Added KmHealthReport for periodic health-check payloads.
 *   - Added GoldEntryUpdate for future edit/correction events.
 *   - Provenance now includes `batchId` for batch-level traceability.
 */

// ---------------------------------------------------------------------------
// Conversation Ingestion
// ---------------------------------------------------------------------------

/** Represents a single LLM conversation detected by the monitor. */
export interface ConversationRecord {
  /** Unique identifier for the conversation (e.g., session ID, thread ID). */
  id: string;
  /** The LLM interface or platform this conversation originated from. */
  source: ConversationSource;
  /** ISO-8601 timestamp when the conversation was first detected. */
  detectedAt: string;
  /** The raw text content of the conversation. */
  content: string;
  /** Optional URL or deep-link to the original conversation. */
  originUrl?: string;
  /** Optional metadata bag for source-specific fields. */
  metadata?: Record<string, unknown>;
}

/**
 * Enumeration of supported LLM interface sources.
 * String union allows arbitrary source identifiers for custom adapters.
 */
export type ConversationSource =
  | "openai-chatgpt"
  | "anthropic-claude"
  | "google-gemini"
  | "mistral"
  | "meta-llama"
  | "cohere"
  | "xai-grok"
  | "perplexity"
  | "deepseek"
  | "openclaw-session"
  | "custom-webhook"
  | string;

/**
 * Synchronisation record: tracks when a conversation from one LLM interface
 * was detected and integrated into the km-monitor pipeline.
 */
export interface SyncRecord {
  /** Unique identifier for this sync event. */
  id: string;
  /** The source adapter that produced the conversation. */
  source: ConversationSource;
  /** The conversation ID that was synchronised. */
  conversationId: string;
  /** ISO-8601 timestamp of synchronisation. */
  syncedAt: string;
  /** Number of gold entries produced from this conversation. */
  goldExtracted: number;
  /** Whether the sync was a dry run (no writes). */
  dryRun: boolean;
}

/**
 * A batch of synchronisation records from a single scan cycle.
 * Enables batch-level traceability across multiple conversations.
 */
export interface SyncBatch {
  /** Unique batch identifier (UUID v4). */
  batchId: string;
  /** Cycle number this batch belongs to. */
  cycleNumber: number;
  /** ISO-8601 timestamp when the batch was created. */
  createdAt: string;
  /** All sync records in this batch. */
  records: SyncRecord[];
  /** Total gold entries extracted across all records. */
  totalGoldExtracted: number;
}

// ---------------------------------------------------------------------------
// Knowledge Map (KM) Enrichment
// ---------------------------------------------------------------------------

/** A single "gold" knowledge entry extracted from a conversation. */
export interface GoldEntry {
  /** Unique identifier for this knowledge entry (UUID v4). */
  id: string;
  /** Short, human-readable title summarising the insight. */
  title: string;
  /** The full, verified insight text. */
  body: string;
  /** Confidence score in [0, 1] assigned by the LLM extractor. */
  confidence: number;
  /** Tags for categorisation and retrieval. */
  tags: string[];
  /** Full traceability chain: which conversation produced this entry. */
  provenance: Provenance;
  /** ISO-8601 timestamp when this entry was added to the KM. */
  addedAt: string;
}

/** Traceability record linking a KM entry back to its origin. */
export interface Provenance {
  /** ID of the source ConversationRecord. */
  conversationId: string;
  /** The LLM interface that produced the conversation. */
  source: ConversationSource;
  /** URL or reference to the original conversation, if available. */
  originUrl?: string;
  /** The agent or pipeline step that extracted this entry. */
  extractedBy: string;
  /** ISO-8601 timestamp of extraction. */
  extractedAt: string;
  /** Optional: model name used for extraction (e.g., "gpt-4.1-mini"). */
  extractionModel?: string;
  /** Optional: raw LLM confidence score before threshold filtering. */
  rawConfidence?: number;
  /** Optional: batch ID for batch-level traceability. */
  batchId?: string;
}

/** A correction or update to an existing GoldEntry (for future edit support). */
export interface GoldEntryUpdate {
  /** The ID of the entry being updated. */
  entryId: string;
  /** New title (if changed). */
  title?: string;
  /** New body (if changed). */
  body?: string;
  /** New confidence score (if changed). */
  confidence?: number;
  /** New tags (if changed). */
  tags?: string[];
  /** ISO-8601 timestamp of the update. */
  updatedAt: string;
  /** Reason for the update. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Audit Trail
// ---------------------------------------------------------------------------

/**
 * An immutable audit event recording every change to the Knowledge Map.
 * Appended to the audit log on every write, enabling full change-log traceability.
 */
export interface KmAuditEvent {
  /** Discriminator for the event type. */
  kind: "km-audit";
  /** ISO-8601 timestamp of the event. */
  timestamp: string;
  /** The action performed. */
  action: "add" | "skip-duplicate" | "skip-low-confidence" | "scan-error" | "update";
  /** ID of the affected GoldEntry (if applicable). */
  entryId?: string;
  /** Title of the affected GoldEntry (if applicable). */
  entryTitle?: string;
  /** Source of the conversation that triggered the event. */
  source: ConversationSource;
  /** Conversation ID that triggered the event. */
  conversationId: string;
  /** Batch ID for batch-level traceability (v1.2.0+). */
  batchId?: string;
  /** Additional detail for error events. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Per-source summary included in change notifications. */
export interface SourceSummary {
  /** The LLM interface source. */
  source: ConversationSource;
  /** Number of new conversations detected from this source. */
  conversationsDetected: number;
  /** Number of gold entries extracted from this source. */
  goldExtracted: number;
}

/** Notification payload dispatched when the KM changes. */
export interface KmChangeNotification {
  /** Type discriminator for the notification. */
  kind: "km-change";
  /** Summary of what changed. */
  summary: string;
  /** Number of new gold entries added in this cycle. */
  newEntriesCount: number;
  /** The entries themselves, for inline display. */
  entries: GoldEntry[];
  /** Per-source breakdown for this cycle. */
  sourceSummaries: SourceSummary[];
  /** Any adapter errors encountered during this cycle. */
  scanErrors: Array<{ adapter: string; error: string }>;
  /** ISO-8601 timestamp of the notification. */
  notifiedAt: string;
  /** Cycle sequence number (monotonically increasing). */
  cycleNumber: number;
  /** Batch ID for this cycle's sync batch (v1.2.0+). */
  batchId?: string;
}

/**
 * Periodic health report dispatched by the monitor (v1.2.0+).
 * Sent even when no new entries are found, to confirm the monitor is alive.
 */
export interface KmHealthReport {
  /** Type discriminator. */
  kind: "km-health";
  /** ISO-8601 timestamp. */
  reportedAt: string;
  /** Current cycle count. */
  cycleCount: number;
  /** Total conversations processed since inception. */
  totalProcessed: number;
  /** Total gold entries in the KM. */
  totalGoldEntries: number;
  /** Per-source statistics. */
  sourceStats: Record<string, { processed: number; goldAdded: number }>;
  /** Whether the monitor is currently running. */
  monitorRunning: boolean;
  /** Interval in milliseconds between scan cycles. */
  intervalMs: number;
}

// ---------------------------------------------------------------------------
// Monitor State
// ---------------------------------------------------------------------------

/** Persisted state for the monitor loop (stored as JSON on disk). */
export interface MonitorState {
  /** Map of source → last-seen conversation ID, for deduplication. */
  lastSeenIds: Record<string, string>;
  /** Total number of conversations processed since inception. */
  totalProcessed: number;
  /** Total number of gold entries ever added to the KM. */
  totalGoldAdded: number;
  /** ISO-8601 timestamp of the last successful scan cycle. */
  lastScanAt: string | null;
  /** Monotonically increasing cycle counter. */
  cycleCount: number;
  /** Per-source statistics for observability. */
  sourceStats: Record<string, { processed: number; goldAdded: number }>;
  /** Last batch ID for traceability (v1.2.0+). */
  lastBatchId?: string;
}
