/**
 * km-monitor/src/notifier.ts
 *
 * Notification Dispatcher — sends structured notifications whenever the
 * Knowledge Map is updated. Notifications include:
 *   - A human-readable summary of what changed.
 *   - The full list of new gold entries with provenance metadata.
 *   - A per-source breakdown of conversations detected and gold extracted.
 *   - Any adapter errors encountered during the scan cycle.
 *   - A monotonic cycle number for ordering and deduplication.
 *
 * Supported notification channels (configured via environment variables):
 *   - **Console** (always active): structured JSON log to stdout.
 *   - **File** (`KM_MONITOR_NOTIFY_FILE`): append to a NDJSON log file.
 *   - **Webhook** (`KM_MONITOR_NOTIFY_WEBHOOK_URL`): HTTP POST to an
 *     arbitrary endpoint (e.g., Discord, Slack, custom API).
 *
 * Enhanced in v1.1.0:
 *   - Added per-source SourceSummary breakdown to notifications.
 *   - Added scanErrors and cycleNumber to KmChangeNotification.
 *   - Discord/Slack payloads now include per-source stats and error alerts.
 *   - Console output now includes full provenance (model, rawConfidence).
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  GoldEntry,
  KmChangeNotification,
  SourceSummary,
  ConversationRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// Notification builder
// ---------------------------------------------------------------------------

/**
 * Build a KmChangeNotification from the current cycle's results.
 *
 * @param entries - Gold entries added in this cycle.
 * @param scanErrors - Adapter errors encountered during scanning.
 * @param newConversations - All new conversations detected (for per-source stats).
 * @param cycleNumber - Monotonic cycle counter from state.
 */
export function buildNotification(
  entries: GoldEntry[],
  scanErrors: Array<{ adapter: string; error: string }>,
  newConversations: ConversationRecord[] = [],
  cycleNumber = 0,
): KmChangeNotification {
  const now = new Date().toISOString();

  // Build per-source summaries.
  const sourceMap = new Map<
    string,
    { conversationsDetected: number; goldExtracted: number }
  >();

  for (const conv of newConversations) {
    const existing = sourceMap.get(conv.source) ?? {
      conversationsDetected: 0,
      goldExtracted: 0,
    };
    sourceMap.set(conv.source, {
      ...existing,
      conversationsDetected: existing.conversationsDetected + 1,
    });
  }

  for (const entry of entries) {
    const src = entry.provenance.source;
    const existing = sourceMap.get(src) ?? {
      conversationsDetected: 0,
      goldExtracted: 0,
    };
    sourceMap.set(src, {
      ...existing,
      goldExtracted: existing.goldExtracted + 1,
    });
  }

  const sourceSummaries: SourceSummary[] = Array.from(
    sourceMap.entries(),
  ).map(([source, stats]) => ({ source, ...stats }));

  const sourceList = sourceSummaries
    .filter((s) => s.goldExtracted > 0)
    .map((s) => s.source)
    .join(", ");

  const summary =
    entries.length === 0
      ? `Knowledge Map scan #${cycleNumber} completed — no new gold entries found.${scanErrors.length > 0 ? ` (${scanErrors.length} adapter error(s))` : ""}`
      : `Knowledge Map updated (cycle #${cycleNumber}): ${entries.length} new gold entr${entries.length === 1 ? "y" : "ies"} added from [${sourceList}].${scanErrors.length > 0 ? ` (${scanErrors.length} adapter error(s))` : ""}`;

  return {
    kind: "km-change",
    summary,
    newEntriesCount: entries.length,
    entries,
    sourceSummaries,
    scanErrors,
    notifiedAt: now,
    cycleNumber,
  };
}

// ---------------------------------------------------------------------------
// Console channel
// ---------------------------------------------------------------------------

function notifyConsole(notification: KmChangeNotification): void {
  console.log(
    JSON.stringify(
      {
        "[km-monitor]": notification.summary,
        cycle: notification.cycleNumber,
        newEntries: notification.newEntriesCount,
        notifiedAt: notification.notifiedAt,
        sourceSummaries: notification.sourceSummaries,
        scanErrors: notification.scanErrors,
        entries: notification.entries.map((e) => ({
          id: e.id,
          title: e.title,
          confidence: e.confidence,
          rawConfidence: e.provenance.rawConfidence ?? null,
          tags: e.tags,
          source: e.provenance.source,
          conversationId: e.provenance.conversationId,
          originUrl: e.provenance.originUrl ?? null,
          extractedBy: e.provenance.extractedBy,
          extractionModel: e.provenance.extractionModel ?? null,
          extractedAt: e.provenance.extractedAt,
        })),
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// File channel
// ---------------------------------------------------------------------------

function notifyFile(notification: KmChangeNotification): void {
  const filePath = process.env.KM_MONITOR_NOTIFY_FILE;
  if (!filePath) return;

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  appendFileSync(filePath, JSON.stringify(notification) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Webhook channel (Discord / Slack / custom)
// ---------------------------------------------------------------------------

/** Build a rich Discord embed payload. */
function buildDiscordPayload(notification: KmChangeNotification): string {
  const lines: string[] = [
    `**Knowledge Map Update — Cycle #${notification.cycleNumber}**`,
    `_${notification.notifiedAt}_`,
    ``,
    notification.summary,
    ``,
  ];

  // Per-source breakdown.
  if (notification.sourceSummaries.length > 0) {
    lines.push(`**Sources scanned:**`);
    for (const s of notification.sourceSummaries) {
      lines.push(
        `  \`${s.source}\` — ${s.conversationsDetected} conversation(s), ${s.goldExtracted} gold entr${s.goldExtracted === 1 ? "y" : "ies"}`,
      );
    }
    lines.push(``);
  }

  // New entries (up to 5).
  if (notification.entries.length > 0) {
    lines.push(`**New gold entries:**`);
    for (const entry of notification.entries.slice(0, 5)) {
      lines.push(
        `• **${entry.title}** _(${(entry.confidence * 100).toFixed(0)}% confidence)_`,
      );
      lines.push(
        `  Source: \`${entry.provenance.source}\` | Conv: \`${entry.provenance.conversationId}\``,
      );
      if (entry.provenance.originUrl) {
        lines.push(`  URL: ${entry.provenance.originUrl}`);
      }
    }
    if (notification.entries.length > 5) {
      lines.push(`_…and ${notification.entries.length - 5} more._`);
    }
    lines.push(``);
  }

  // Errors.
  if (notification.scanErrors.length > 0) {
    lines.push(`⚠️ **Adapter errors:**`);
    for (const err of notification.scanErrors) {
      lines.push(`  \`${err.adapter}\`: ${err.error}`);
    }
  }

  return JSON.stringify({ content: lines.join("\n") });
}

/** Build a Slack message payload. */
function buildSlackPayload(notification: KmChangeNotification): string {
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Knowledge Map Update — Cycle #${notification.cycleNumber}*\n${notification.summary}`,
      },
    },
  ];

  if (notification.sourceSummaries.length > 0) {
    const sourceText = notification.sourceSummaries
      .map(
        (s) =>
          `• \`${s.source}\`: ${s.conversationsDetected} conv(s), ${s.goldExtracted} gold`,
      )
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Sources:*\n${sourceText}` },
    });
  }

  for (const entry of notification.entries.slice(0, 5)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${entry.title}* (${(entry.confidence * 100).toFixed(0)}%)`,
          entry.body.slice(0, 200),
          `Source: \`${entry.provenance.source}\` | Conv: \`${entry.provenance.conversationId}\``,
          entry.provenance.originUrl ? `URL: ${entry.provenance.originUrl}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });
  }

  if (notification.scanErrors.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `⚠️ *Adapter errors:*\n` +
          notification.scanErrors
            .map((e) => `• \`${e.adapter}\`: ${e.error}`)
            .join("\n"),
      },
    });
  }

  return JSON.stringify({ blocks });
}

async function notifyWebhook(
  notification: KmChangeNotification,
): Promise<void> {
  const webhookUrl = process.env.KM_MONITOR_NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) return;

  let body: string;
  if (webhookUrl.includes("discord.com")) {
    body = buildDiscordPayload(notification);
  } else if (webhookUrl.includes("hooks.slack.com")) {
    body = buildSlackPayload(notification);
  } else {
    body = JSON.stringify(notification);
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (err) {
    console.error("[km-monitor/notifier] Webhook delivery failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Public dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a KM-change notification across all configured channels.
 * Always fires the console channel; other channels are opt-in via env vars.
 *
 * @param entries - Gold entries added in this cycle.
 * @param scanErrors - Adapter errors encountered during scanning.
 * @param newConversations - All new conversations detected (for per-source stats).
 * @param cycleNumber - Monotonic cycle counter from state.
 */
export async function dispatchNotification(
  entries: GoldEntry[],
  scanErrors: Array<{ adapter: string; error: string }> = [],
  newConversations: ConversationRecord[] = [],
  cycleNumber = 0,
): Promise<KmChangeNotification> {
  const notification = buildNotification(
    entries,
    scanErrors,
    newConversations,
    cycleNumber,
  );

  // Console is always active.
  notifyConsole(notification);

  // File channel (optional).
  notifyFile(notification);

  // Webhook channel (optional, async).
  await notifyWebhook(notification);

  return notification;
}
