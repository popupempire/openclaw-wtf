/**
 * km-monitor/src/notifier.ts  — v1.2.0
 *
 * Notification Dispatcher — sends structured notifications whenever the
 * Knowledge Map is updated, and periodic health reports.
 *
 * Changes in v1.2.0:
 *   - Added `batchId` to all notification payloads for traceability.
 *   - Added `dispatchHealthReport()` for periodic liveness signals.
 *   - Discord and Slack payloads now include batch ID.
 *   - Added Teams webhook support (generic JSON fallback with Teams card hint).
 *   - Console output now includes batch ID and health report formatting.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  GoldEntry,
  KmChangeNotification,
  KmHealthReport,
  SourceSummary,
  ConversationRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// Notification builder
// ---------------------------------------------------------------------------

export function buildNotification(
  entries: GoldEntry[],
  scanErrors: Array<{ adapter: string; error: string }>,
  newConversations: ConversationRecord[] = [],
  cycleNumber = 0,
  batchId?: string,
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

  const sourceSummaries: SourceSummary[] = Array.from(sourceMap.entries()).map(
    ([source, stats]) => ({ source, ...stats }),
  );

  const summary =
    entries.length === 0
      ? `Cycle #${cycleNumber}: No new gold entries found.`
      : `Cycle #${cycleNumber}: ${entries.length} new gold entr${entries.length === 1 ? "y" : "ies"} added from ${sourceSummaries.length} source(s).`;

  return {
    kind: "km-change",
    summary,
    newEntriesCount: entries.length,
    entries,
    sourceSummaries,
    scanErrors,
    notifiedAt: now,
    cycleNumber,
    batchId,
  };
}

// ---------------------------------------------------------------------------
// Console channel
// ---------------------------------------------------------------------------

function notifyConsole(notification: KmChangeNotification): void {
  const prefix = `[km-monitor/notify]`;
  console.log(`${prefix} ─────────────────────────────────────────`);
  console.log(`${prefix} ${notification.summary}`);
  if (notification.batchId) {
    console.log(`${prefix} Batch ID: ${notification.batchId}`);
  }
  if (notification.sourceSummaries.length > 0) {
    console.log(`${prefix} Sources:`);
    for (const s of notification.sourceSummaries) {
      console.log(
        `${prefix}   ${s.source}: ${s.conversationsDetected} conv(s), ${s.goldExtracted} gold`,
      );
    }
  }
  if (notification.entries.length > 0) {
    console.log(`${prefix} New entries:`);
    for (const entry of notification.entries) {
      console.log(`${prefix}   [${(entry.confidence * 100).toFixed(0)}%] ${entry.title}`);
      console.log(`${prefix}     source=${entry.provenance.source} | conv=${entry.provenance.conversationId}`);
      if (entry.provenance.extractionModel) {
        console.log(`${prefix}     model=${entry.provenance.extractionModel} | rawConf=${entry.provenance.rawConfidence?.toFixed(3)}`);
      }
      if (entry.provenance.originUrl) {
        console.log(`${prefix}     url=${entry.provenance.originUrl}`);
      }
    }
  }
  if (notification.scanErrors.length > 0) {
    console.log(`${prefix} ⚠ Adapter errors:`);
    for (const err of notification.scanErrors) {
      console.log(`${prefix}   [${err.adapter}]: ${err.error}`);
    }
  }
  console.log(`${prefix} ─────────────────────────────────────────`);
}

// ---------------------------------------------------------------------------
// File channel
// ---------------------------------------------------------------------------

function notifyFile(notification: KmChangeNotification): void {
  const filePath = process.env.KM_MONITOR_NOTIFY_FILE;
  if (!filePath) return;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    appendFileSync(filePath, JSON.stringify(notification) + "\n", "utf-8");
  } catch (err) {
    console.error("[km-monitor/notifier] Failed to write notification file:", err);
  }
}

// ---------------------------------------------------------------------------
// Webhook channel
// ---------------------------------------------------------------------------

function buildDiscordPayload(notification: KmChangeNotification): string {
  const lines: string[] = [
    `**Knowledge Map Update — Cycle #${notification.cycleNumber}**`,
    `_${notification.notifiedAt}_`,
    notification.batchId ? `Batch: \`${notification.batchId}\`` : "",
    ``,
    notification.summary,
    ``,
  ].filter((l) => l !== "");

  if (notification.sourceSummaries.length > 0) {
    lines.push(`**Sources scanned:**`);
    for (const s of notification.sourceSummaries) {
      lines.push(
        `  \`${s.source}\` — ${s.conversationsDetected} conversation(s), ${s.goldExtracted} gold entr${s.goldExtracted === 1 ? "y" : "ies"}`,
      );
    }
    lines.push(``);
  }

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

  if (notification.scanErrors.length > 0) {
    lines.push(`⚠️ **Adapter errors:**`);
    for (const err of notification.scanErrors) {
      lines.push(`  \`${err.adapter}\`: ${err.error}`);
    }
  }

  return JSON.stringify({ content: lines.join("\n") });
}

function buildSlackPayload(notification: KmChangeNotification): string {
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Knowledge Map Update — Cycle #${notification.cycleNumber}*`,
          notification.batchId ? `Batch: \`${notification.batchId}\`` : null,
          notification.summary,
        ].filter(Boolean).join("\n"),
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
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      console.error(
        `[km-monitor/notifier] Webhook returned HTTP ${res.status}: ${await res.text()}`,
      );
    }
  } catch (err) {
    console.error("[km-monitor/notifier] Webhook delivery failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Public dispatchers
// ---------------------------------------------------------------------------

/**
 * Dispatch a KM-change notification across all configured channels.
 * Always fires the console channel; other channels are opt-in via env vars.
 */
export async function dispatchNotification(
  entries: GoldEntry[],
  scanErrors: Array<{ adapter: string; error: string }> = [],
  newConversations: ConversationRecord[] = [],
  cycleNumber = 0,
  batchId?: string,
): Promise<KmChangeNotification> {
  const notification = buildNotification(
    entries,
    scanErrors,
    newConversations,
    cycleNumber,
    batchId,
  );
  notifyConsole(notification);
  notifyFile(notification);
  await notifyWebhook(notification);
  return notification;
}

/**
 * Dispatch a periodic health report to configured channels.
 * Only fires if `KM_MONITOR_NOTIFY_FILE` or `KM_MONITOR_NOTIFY_WEBHOOK_URL` is set,
 * plus always logs to console.
 */
export async function dispatchHealthReport(report: KmHealthReport): Promise<void> {
  console.log(
    `[km-monitor/health] cycle=${report.cycleCount} | processed=${report.totalProcessed} | goldEntries=${report.totalGoldEntries} | running=${report.monitorRunning}`,
  );

  // File channel.
  const filePath = process.env.KM_MONITOR_NOTIFY_FILE;
  if (filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    try {
      appendFileSync(filePath, JSON.stringify(report) + "\n", "utf-8");
    } catch (err) {
      console.error("[km-monitor/notifier] Failed to write health report to file:", err);
    }
  }

  // Webhook channel.
  const webhookUrl = process.env.KM_MONITOR_NOTIFY_WEBHOOK_URL;
  if (webhookUrl) {
    let body: string;
    if (webhookUrl.includes("discord.com")) {
      body = JSON.stringify({
        content: [
          `**KM Monitor Health Report — Cycle #${report.cycleCount}**`,
          `_${report.reportedAt}_`,
          `Total processed: ${report.totalProcessed} | Gold entries: ${report.totalGoldEntries} | Running: ${report.monitorRunning}`,
        ].join("\n"),
      });
    } else if (webhookUrl.includes("hooks.slack.com")) {
      body = JSON.stringify({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*KM Monitor Health — Cycle #${report.cycleCount}*\nProcessed: ${report.totalProcessed} | Gold: ${report.totalGoldEntries} | Running: ${report.monitorRunning}`,
            },
          },
        ],
      });
    } else {
      body = JSON.stringify(report);
    }
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      console.error("[km-monitor/notifier] Health report webhook delivery failed:", err);
    }
  }
}
