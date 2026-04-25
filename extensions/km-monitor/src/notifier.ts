/**
 * km-monitor/src/notifier.ts
 *
 * Notification Dispatcher — sends structured notifications whenever the
 * Knowledge Map is updated. Notifications include:
 *   - A human-readable summary of what changed.
 *   - The full list of new gold entries with provenance metadata.
 *   - A timestamp and traceability chain.
 *
 * Supported notification channels (configured via environment variables):
 *   - **Console** (always active): structured JSON log to stdout.
 *   - **File** (`KM_MONITOR_NOTIFY_FILE`): append to a NDJSON log file.
 *   - **Webhook** (`KM_MONITOR_NOTIFY_WEBHOOK_URL`): HTTP POST to an
 *     arbitrary endpoint (e.g., Discord, Slack, custom API).
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GoldEntry, KmChangeNotification } from "./types.js";

// ---------------------------------------------------------------------------
// Notification builder
// ---------------------------------------------------------------------------

export function buildNotification(
  entries: GoldEntry[],
  scanErrors: Array<{ adapter: string; error: string }>,
): KmChangeNotification {
  const now = new Date().toISOString();
  const sourceList = [
    ...new Set(entries.map((e) => e.provenance.source)),
  ].join(", ");

  const summary =
    entries.length === 0
      ? "Knowledge Map scan completed — no new gold entries found."
      : `Knowledge Map updated: ${entries.length} new gold entr${entries.length === 1 ? "y" : "ies"} added from [${sourceList}].${scanErrors.length > 0 ? ` (${scanErrors.length} adapter error(s) encountered)` : ""}`;

  return {
    kind: "km-change",
    summary,
    newEntriesCount: entries.length,
    entries,
    notifiedAt: now,
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
        newEntries: notification.newEntriesCount,
        notifiedAt: notification.notifiedAt,
        entries: notification.entries.map((e) => ({
          id: e.id,
          title: e.title,
          confidence: e.confidence,
          tags: e.tags,
          source: e.provenance.source,
          conversationId: e.provenance.conversationId,
          originUrl: e.provenance.originUrl ?? null,
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
// Webhook channel
// ---------------------------------------------------------------------------

async function notifyWebhook(
  notification: KmChangeNotification,
): Promise<void> {
  const webhookUrl = process.env.KM_MONITOR_NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) return;

  // Build a Discord/Slack-compatible payload if the URL contains those hosts,
  // otherwise send raw JSON.
  let body: string;
  if (
    webhookUrl.includes("discord.com") ||
    webhookUrl.includes("hooks.slack.com")
  ) {
    const lines = [
      `**Knowledge Map Update** — ${notification.notifiedAt}`,
      notification.summary,
      "",
    ];
    for (const entry of notification.entries.slice(0, 5)) {
      lines.push(
        `• **${entry.title}** _(${(entry.confidence * 100).toFixed(0)}% confidence)_`,
      );
      lines.push(`  Source: \`${entry.provenance.source}\` | ID: \`${entry.id}\``);
      if (entry.provenance.originUrl) {
        lines.push(`  URL: ${entry.provenance.originUrl}`);
      }
    }
    if (notification.entries.length > 5) {
      lines.push(`_…and ${notification.entries.length - 5} more._`);
    }
    body = JSON.stringify({ content: lines.join("\n") });
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
 */
export async function dispatchNotification(
  entries: GoldEntry[],
  scanErrors: Array<{ adapter: string; error: string }> = [],
): Promise<KmChangeNotification> {
  const notification = buildNotification(entries, scanErrors);

  // Console is always active.
  notifyConsole(notification);

  // File channel (optional).
  notifyFile(notification);

  // Webhook channel (optional, async).
  await notifyWebhook(notification);

  return notification;
}
