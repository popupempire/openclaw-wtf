/**
 * km-monitor/src/types.ts
 *
 * Shared type definitions for the Knowledge Map Monitor extension.
 * All data flowing through the pipeline is typed here for strict safety.
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

/** Enumeration of supported LLM interface sources. */
export type ConversationSource =
  | "openai-chatgpt"
  | "anthropic-claude"
  | "google-gemini"
  | "mistral"
  | "openclaw-session"
  | "custom-webhook"
  | string;

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
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

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
  /** ISO-8601 timestamp of the notification. */
  notifiedAt: string;
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
}
