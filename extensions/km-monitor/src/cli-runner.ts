#!/usr/bin/env node
/**
 * km-monitor/src/cli-runner.ts
 *
 * Standalone CLI runner for the Knowledge Map Monitor.
 * Can be invoked directly without the full OpenClaw CLI:
 *
 *   npx ts-node extensions/km-monitor/src/cli-runner.ts [command]
 *   bun extensions/km-monitor/src/cli-runner.ts [command]
 *
 * Commands:
 *   start   — Start the continuous monitoring loop.
 *   scan    — Run a single scan cycle and exit.
 *   search  — Search the KM (pass query as second arg).
 *   status  — Print the current monitor state.
 *
 * Environment variables (all optional):
 *   KM_MONITOR_INTERVAL_MS         — Polling interval (default: 60000)
 *   KM_MONITOR_CONFIDENCE          — Min confidence threshold (default: 0.6)
 *   KM_MONITOR_DRY_RUN             — Set to "1" for dry-run mode
 *   KM_MONITOR_STATE_PATH          — Override state file path
 *   KM_MONITOR_KM_DIR              — Override KM output directory
 *   KM_MONITOR_NOTIFY_FILE         — Path to NDJSON notification log
 *   KM_MONITOR_NOTIFY_WEBHOOK_URL  — Webhook URL for notifications
 *   KM_MONITOR_WEBHOOK_BUFFER      — Path to incoming webhook buffer file
 */

import { startMonitor, runOnce } from "./monitor-loop.js";
import { searchKnowledgeMap, getAllKnowledgeMapEntries } from "./km-writer.js";
import { loadState } from "./state.js";

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "start": {
      console.log("[km-monitor] Starting continuous monitor…");
      // Graceful shutdown on SIGINT / SIGTERM.
      process.on("SIGINT", () => {
        console.log("\n[km-monitor] Received SIGINT — stopping…");
        const { stopMonitor } = require("./monitor-loop.js");
        stopMonitor();
      });
      process.on("SIGTERM", () => {
        console.log("[km-monitor] Received SIGTERM — stopping…");
        const { stopMonitor } = require("./monitor-loop.js");
        stopMonitor();
      });
      await startMonitor();
      break;
    }

    case "scan": {
      const dryRun = args.includes("--dry-run");
      if (dryRun) process.env.KM_MONITOR_DRY_RUN = "1";
      console.log(`[km-monitor] Running one-shot scan (dry-run: ${dryRun})…`);
      await runOnce();
      break;
    }

    case "search": {
      const query = args.join(" ").trim();
      if (!query) {
        console.error("Usage: cli-runner.ts search <query>");
        process.exit(1);
      }
      const results = searchKnowledgeMap(query);
      if (results.length === 0) {
        console.log("No entries found.");
      } else {
        console.log(`Found ${results.length} entr${results.length === 1 ? "y" : "ies"}:\n`);
        for (const entry of results) {
          console.log(`[${entry.id}] ${entry.title}`);
          console.log(`  ${entry.body}`);
          console.log(
            `  Source: ${entry.provenance.source} | Confidence: ${(entry.confidence * 100).toFixed(0)}% | Tags: ${entry.tags.join(", ")}`,
          );
          console.log(
            `  Conversation: ${entry.provenance.conversationId}${entry.provenance.originUrl ? ` | URL: ${entry.provenance.originUrl}` : ""}`,
          );
          console.log();
        }
      }
      break;
    }

    case "status": {
      const state = loadState();
      const allEntries = getAllKnowledgeMapEntries();
      console.log(
        JSON.stringify({ ...state, totalKmEntries: allEntries.length }, null, 2),
      );
      break;
    }

    default: {
      console.log(`
Knowledge Map Monitor — CLI Runner

Usage: cli-runner.ts <command> [options]

Commands:
  start              Start the continuous monitoring loop
  scan [--dry-run]   Run a single scan cycle and exit
  search <query>     Search the Knowledge Map
  status             Print current monitor state

Environment variables:
  KM_MONITOR_INTERVAL_MS         Polling interval in ms (default: 60000)
  KM_MONITOR_CONFIDENCE          Min confidence threshold (default: 0.6)
  KM_MONITOR_DRY_RUN             Set to "1" for dry-run mode
  KM_MONITOR_STATE_PATH          Override state file path
  KM_MONITOR_KM_DIR              Override KM output directory
  KM_MONITOR_NOTIFY_FILE         Path to NDJSON notification log
  KM_MONITOR_NOTIFY_WEBHOOK_URL  Webhook URL (Discord/Slack/custom)
  KM_MONITOR_WEBHOOK_BUFFER      Path to incoming webhook buffer file
`);
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error("[km-monitor] Fatal error:", err);
  process.exit(1);
});
