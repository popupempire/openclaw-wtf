/**
 * km-monitor/src/km-writer.ts  — v1.2.0
 *
 * Knowledge Map Writer — persists extracted gold entries to the local KM
 * and maintains a full audit trail of every change.
 *
 * Changes in v1.2.0:
 *   - `writeToKnowledgeMap()` now accepts an optional `batchId` parameter
 *     and stamps it into every audit event for batch-level traceability.
 *   - Added `getKnowledgeMapEntry()` for single-entry retrieval by ID.
 *   - Markdown log now includes batch ID in the entry header.
 *   - JSON index write is now atomic (write to temp file, then rename).
 */
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { GoldEntry, KmAuditEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function resolveKmDir(): string {
  const home = process.env.HOME ?? "/tmp";
  return (
    process.env.KM_MONITOR_KM_DIR ??
    join(home, ".openclaw", "km-monitor")
  );
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Markdown log
// ---------------------------------------------------------------------------

function appendToMarkdownLog(entries: GoldEntry[]): void {
  const dir = resolveKmDir();
  ensureDir(dir);
  const path = join(dir, "knowledge-map.md");
  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(`## ${entry.title}`);
    lines.push(``);
    lines.push(entry.body);
    lines.push(``);
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **ID** | \`${entry.id}\` |`);
    lines.push(`| **Confidence** | ${(entry.confidence * 100).toFixed(0)}% _(raw: ${((entry.provenance.rawConfidence ?? entry.confidence) * 100).toFixed(1)}%)_ |`);
    lines.push(`| **Tags** | ${entry.tags.map((t) => `\`${t}\``).join(", ")} |`);
    lines.push(`| **Added** | ${entry.addedAt} |`);
    lines.push(`| **Source** | \`${entry.provenance.source}\` |`);
    lines.push(`| **Conversation ID** | \`${entry.provenance.conversationId}\` |`);
    if (entry.provenance.originUrl) {
      lines.push(`| **Origin URL** | [${entry.provenance.originUrl}](${entry.provenance.originUrl}) |`);
    }
    lines.push(`| **Extracted by** | \`${entry.provenance.extractedBy}\` |`);
    if (entry.provenance.extractionModel) {
      lines.push(`| **Extraction model** | \`${entry.provenance.extractionModel}\` |`);
    }
    lines.push(`| **Extracted at** | ${entry.provenance.extractedAt} |`);
    if (entry.provenance.batchId) {
      lines.push(`| **Batch ID** | \`${entry.provenance.batchId}\` |`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }
  appendFileSync(path, lines.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// JSON index (atomic write)
// ---------------------------------------------------------------------------

function loadJsonIndex(): GoldEntry[] {
  const path = join(resolveKmDir(), "knowledge-map.json");
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as GoldEntry[];
  } catch {
    return [];
  }
}

function saveJsonIndex(entries: GoldEntry[]): void {
  const dir = resolveKmDir();
  ensureDir(dir);
  const path = join(dir, "knowledge-map.json");
  const tmpPath = path + ".tmp." + randomUUID();
  writeFileSync(tmpPath, JSON.stringify(entries, null, 2), "utf-8");
  renameSync(tmpPath, path); // atomic on POSIX
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function appendAuditEvent(event: KmAuditEvent): void {
  const dir = resolveKmDir();
  ensureDir(dir);
  const path = join(dir, "audit.ndjson");
  appendFileSync(path, JSON.stringify(event) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface KmWriteResult {
  /** Number of entries successfully written. */
  written: number;
  /** Number of entries skipped because they were already in the index. */
  duplicatesSkipped: number;
  /** Absolute path to the Markdown log. */
  markdownLogPath: string;
  /** Absolute path to the JSON index. */
  jsonIndexPath: string;
  /** Absolute path to the audit log. */
  auditLogPath: string;
}

/**
 * Write a batch of gold entries to the Knowledge Map.
 * Deduplicates by entry ID before writing.
 * Appends audit events for every add and skip-duplicate action.
 *
 * @param entries  - Gold entries to write.
 * @param batchId  - Optional batch ID for batch-level audit traceability.
 */
export function writeToKnowledgeMap(entries: GoldEntry[], batchId?: string): KmWriteResult {
  const dir = resolveKmDir();
  const existing = loadJsonIndex();
  const existingIds = new Set(existing.map((e) => e.id));
  const now = new Date().toISOString();

  const newEntries = entries.filter((e) => !existingIds.has(e.id));
  const duplicates = entries.filter((e) => existingIds.has(e.id));
  const duplicatesSkipped = duplicates.length;

  // Audit: log skipped duplicates.
  for (const dup of duplicates) {
    appendAuditEvent({
      kind: "km-audit",
      timestamp: now,
      action: "skip-duplicate",
      entryId: dup.id,
      entryTitle: dup.title,
      source: dup.provenance.source,
      conversationId: dup.provenance.conversationId,
      batchId,
    });
  }

  if (newEntries.length > 0) {
    appendToMarkdownLog(newEntries);
    saveJsonIndex([...existing, ...newEntries]);
    for (const entry of newEntries) {
      appendAuditEvent({
        kind: "km-audit",
        timestamp: now,
        action: "add",
        entryId: entry.id,
        entryTitle: entry.title,
        source: entry.provenance.source,
        conversationId: entry.provenance.conversationId,
        batchId,
      });
    }
  }

  return {
    written: newEntries.length,
    duplicatesSkipped,
    markdownLogPath: join(dir, "knowledge-map.md"),
    jsonIndexPath: join(dir, "knowledge-map.json"),
    auditLogPath: join(dir, "audit.ndjson"),
  };
}

/**
 * Retrieve a single entry from the JSON index by ID.
 * Returns undefined if not found.
 */
export function getKnowledgeMapEntry(id: string): GoldEntry | undefined {
  return loadJsonIndex().find((e) => e.id === id);
}

/**
 * Search the JSON index for entries matching a query string.
 * Simple case-insensitive substring match across title, body, and tags.
 */
export function searchKnowledgeMap(query: string): GoldEntry[] {
  const lower = query.toLowerCase();
  return loadJsonIndex().filter(
    (e) =>
      e.title.toLowerCase().includes(lower) ||
      e.body.toLowerCase().includes(lower) ||
      e.tags.some((t) => t.toLowerCase().includes(lower)),
  );
}

/**
 * Search the JSON index filtered to a specific LLM source.
 */
export function searchKnowledgeMapBySource(source: string): GoldEntry[] {
  return loadJsonIndex().filter(
    (e) => e.provenance.source === source,
  );
}

/** Return all entries in the JSON index. */
export function getAllKnowledgeMapEntries(): GoldEntry[] {
  return loadJsonIndex();
}

/** Return aggregate statistics about the Knowledge Map. */
export function getKnowledgeMapStats(): {
  totalEntries: number;
  bySource: Record<string, number>;
  avgConfidence: number;
  topTags: Array<{ tag: string; count: number }>;
} {
  const entries = loadJsonIndex();
  const bySource: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  let totalConfidence = 0;

  for (const entry of entries) {
    const src = entry.provenance.source;
    bySource[src] = (bySource[src] ?? 0) + 1;
    totalConfidence += entry.confidence;
    for (const tag of entry.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    totalEntries: entries.length,
    bySource,
    avgConfidence:
      entries.length > 0 ? totalConfidence / entries.length : 0,
    topTags,
  };
}
