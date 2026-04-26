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
 *   start              — Start the continuous monitoring loop.
 *   scan               — Run a single scan cycle and exit.
 *   search <query>     — Search the KM (pass query as second arg).
 *   list [<source>]    — List all KM entries (optionally filtered by source).
 *   stats              — Print KM statistics.
 *   status             — Print the current monitor state.
 *
 * Environment variables (all optional):
 *   KM_MONITOR_INTERVAL_MS         — Polling interval (default: 60000)
 *   KM_MONITOR_CONFIDENCE          — Min confidence threshold (default: 0.6)
 *   KM_MONITOR_DRY_RUN             — Set to "1" for dry-run mode
 *   KM_MONITOR_ALL_ADAPTERS        — Set to "1" to use all named LLM adapters
 *   KM_MONITOR_EXTRACTION_MODEL    — LLM model for gold extraction
 *   KM_MONITOR_STATE_PATH          — Override state file path
 *   KM_MONITOR_KM_DIR              — Override KM output directory
 *   KM_MONITOR_NOTIFY_FILE         — Path to NDJSON notification log
 *   KM_MONITOR_NOTIFY_WEBHOOK_URL  — Webhook URL for notifications
 *   KM_MONITOR_WEBHOOK_BUFFER      — Path to incoming webhook buffer file
 *
 * Enhanced in v1.1.0:
 *   - Added `stats` command.
 *   - Added `list [<source>]` command.
 *   - Added `--all-adapters` flag to `start` and `scan`.
 *   - Source-filtered search via `search --source <source> <query>`.
 */

import { startMonitor, runOnce } from "./monitor-loop.js";
import {
  searchKnowledgeMap,
  searchKnowledgeMapBySource,
  getAllKnowledgeMapEntries,
  getKnowledgeMapStats,
} from "./km-writer.js";
import { loadState } from "./state.js";

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "start": {
      const allAdapters = args.includes("--all-adapters");
      if (allAdapters) process.env.KM_MONITOR_ALL_ADAPTERS = "1";
      console.log(
        `[km-monitor] Starting continuous monitor (all-adapters: ${allAdapters})…`,
      );
      // Graceful shutdown on SIGINT / SIGTERM.
      process.on("SIGINT", () => {
        console.log("\n[km-monitor] Received SIGINT — stopping…");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { stopMonitor } = require("./monitor-loop.js");
        stopMonitor();
      });
      process.on("SIGTERM", () => {
        console.log("[km-monitor] Received SIGTERM — stopping…");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { stopMonitor } = require("./monitor-loop.js");
        stopMonitor();
      });
      await startMonitor();
      break;
    }

    case "scan": {
      const dryRun = args.includes("--dry-run");
      const allAdapters = args.includes("--all-adapters");
      if (dryRun) process.env.KM_MONITOR_DRY_RUN = "1";
      if (allAdapters) process.env.KM_MONITOR_ALL_ADAPTERS = "1";
      console.log(
        `[km-monitor] Running one-shot scan (dry-run: ${dryRun}, all-adapters: ${allAdapters})…`,
      );
      await runOnce();
      break;
    }

    case "search": {
      // Support: search [--source <source>] <query...>
      let sourceFilter: string | undefined;
      const filteredArgs = [...args];
      const sourceIdx = filteredArgs.indexOf("--source");
      if (sourceIdx !== -1 && filteredArgs[sourceIdx + 1]) {
        sourceFilter = filteredArgs[sourceIdx + 1];
        filteredArgs.splice(sourceIdx, 2);
      }

      const query = filteredArgs.join(" ").trim();
      if (!query) {
        console.error("Usage: cli-runner.ts search [--source <source>] <query>");
        process.exit(1);
      }

      const results = sourceFilter
        ? searchKnowledgeMapBySource(sourceFilter).filter(
            (e) =>
              e.title.toLowerCase().includes(query.toLowerCase()) ||
              e.body.toLowerCase().includes(query.toLowerCase()),
          )
        : searchKnowledgeMap(query);

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
          console.log(
            `  Extracted by: ${entry.provenance.extractedBy}${entry.provenance.extractionModel ? ` (${entry.provenance.extractionModel})` : ""}`,
          );
          console.log();
        }
      }
      break;
    }

    case "list": {
      const sourceFilter = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
      const entries = sourceFilter
        ? searchKnowledgeMapBySource(sourceFilter)
        : getAllKnowledgeMapEntries();
      console.log(
        `Total entries${sourceFilter ? ` (source: ${sourceFilter})` : ""}: ${entries.length}\n`,
      );
      for (const entry of entries) {
        console.log(`[${entry.id}] ${entry.title}`);
        console.log(
          `  Source: ${entry.provenance.source} | Confidence: ${(entry.confidence * 100).toFixed(0)}% | Added: ${entry.addedAt}`,
        );
        console.log(
          `  Conv: ${entry.provenance.conversationId}${entry.provenance.originUrl ? ` | URL: ${entry.provenance.originUrl}` : ""}`,
        );
        console.log();
      }
      break;
    }

    case "stats": {
      const stats = getKnowledgeMapStats();
      console.log(JSON.stringify(stats, null, 2));
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
Knowledge Map Monitor — CLI Runner v1.1.0

Usage: cli-runner.ts <command> [options]

Commands:
  start [--all-adapters]              Start the continuous monitoring loop
  scan [--dry-run] [--all-adapters]   Run a single scan cycle and exit
  search [--source <src>] <query>     Search the Knowledge Map
  list [<source>]                     List all KM entries (optionally filtered by source)
  stats                               Print KM statistics (counts, top tags, per-source)
  status                              Print current monitor state

Environment variables:
  KM_MONITOR_INTERVAL_MS         Polling interval in ms (default: 60000)
  KM_MONITOR_CONFIDENCE          Min confidence threshold (default: 0.6)
  KM_MONITOR_DRY_RUN             Set to "1" for dry-run mode
  KM_MONITOR_ALL_ADAPTERS        Set to "1" to use all named LLM adapters
  KM_MONITOR_EXTRACTION_MODEL    LLM model for gold extraction (default: gpt-4.1-mini)
  KM_MONITOR_STATE_PATH          Override state file path
  KM_MONITOR_KM_DIR              Override KM output directory
  KM_MONITOR_NOTIFY_FILE         Path to NDJSON notification log
  KM_MONITOR_NOTIFY_WEBHOOK_URL  Webhook URL (Discord/Slack/custom)
  KM_MONITOR_WEBHOOK_BUFFER      Path to incoming webhook buffer file

Supported LLM sources (for --source filter):
  openai-chatgpt, anthropic-claude, google-gemini, mistral, meta-llama, openclaw-session
`);
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error("[km-monitor] Fatal error:", err);
  process.exit(1);
});
