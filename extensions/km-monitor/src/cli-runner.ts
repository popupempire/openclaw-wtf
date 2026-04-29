/**
 * km-monitor/src/cli-runner.ts  — v1.2.0
 *
 * Standalone CLI runner for the Knowledge Map Monitor.
 * Can be invoked directly (without the OpenClaw gateway) for testing,
 * cron-based invocation, or standalone deployments.
 *
 * Changes in v1.2.0:
 *   - Added `--extended-adapters` flag to `start` and `scan` commands.
 *   - Added `health` command to print current monitor health.
 *   - Added `get <id>` command to retrieve a single KM entry by ID.
 *   - Updated help text with all v1.2.0 env vars.
 */
import { startMonitor, runOnce } from "./monitor-loop.js";
import {
  searchKnowledgeMap,
  searchKnowledgeMapBySource,
  getAllKnowledgeMapEntries,
  getKnowledgeMapStats,
  getKnowledgeMapEntry,
} from "./km-writer.js";
import { loadState } from "./state.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "start": {
      if (args.includes("--all-adapters")) process.env.KM_MONITOR_ALL_ADAPTERS = "1";
      if (args.includes("--extended-adapters")) process.env.KM_MONITOR_EXTENDED_ADAPTERS = "1";
      const intervalArg = args.find((a) => a.startsWith("--interval="));
      if (intervalArg) process.env.KM_MONITOR_INTERVAL_MS = intervalArg.split("=")[1];
      await startMonitor();
      break;
    }
    case "scan": {
      if (args.includes("--dry-run")) process.env.KM_MONITOR_DRY_RUN = "1";
      if (args.includes("--all-adapters")) process.env.KM_MONITOR_ALL_ADAPTERS = "1";
      if (args.includes("--extended-adapters")) process.env.KM_MONITOR_EXTENDED_ADAPTERS = "1";
      await runOnce();
      break;
    }
    case "search": {
      const sourceIdx = args.indexOf("--source");
      const sourceFilter = sourceIdx !== -1 ? args[sourceIdx + 1] : undefined;
      const filteredArgs = args.filter(
        (a, i) => a !== "--source" && i !== sourceIdx + 1,
      );
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
          if (entry.provenance.batchId) {
            console.log(`  Batch ID: ${entry.provenance.batchId}`);
          }
          console.log();
        }
      }
      break;
    }
    case "get": {
      const id = args[0];
      if (!id) {
        console.error("Usage: cli-runner.ts get <entry-id>");
        process.exit(1);
      }
      const entry = getKnowledgeMapEntry(id);
      if (!entry) {
        console.log(`Entry not found: ${id}`);
      } else {
        console.log(JSON.stringify(entry, null, 2));
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
        if (entry.provenance.batchId) {
          console.log(`  Batch: ${entry.provenance.batchId}`);
        }
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
    case "health": {
      const state = loadState();
      const allEntries = getAllKnowledgeMapEntries();
      const stats = getKnowledgeMapStats();
      console.log(JSON.stringify({
        kind: "km-health",
        reportedAt: new Date().toISOString(),
        cycleCount: state.cycleCount,
        totalProcessed: state.totalProcessed,
        totalGoldEntries: allEntries.length,
        sourceStats: state.sourceStats,
        lastScanAt: state.lastScanAt,
        lastBatchId: state.lastBatchId,
        kmStats: stats,
      }, null, 2));
      break;
    }
    default: {
      console.log(`
Knowledge Map Monitor — CLI Runner v1.2.0
Usage: cli-runner.ts <command> [options]

Commands:
  start [--all-adapters] [--extended-adapters] [--interval=<ms>]
                              Start the continuous monitoring loop
  scan [--dry-run] [--all-adapters] [--extended-adapters]
                              Run a single scan cycle and exit
  search [--source <src>] <query>
                              Search the Knowledge Map
  get <id>                    Retrieve a single KM entry by ID
  list [<source>]             List all KM entries (optionally filtered by source)
  stats                       Print KM statistics (counts, top tags, per-source)
  status                      Print current monitor state
  health                      Print current health report (JSON)

Environment variables:
  KM_MONITOR_INTERVAL_MS           Polling interval in ms (default: 60000)
  KM_MONITOR_CONFIDENCE            Min confidence threshold (default: 0.6)
  KM_MONITOR_DRY_RUN               Set to "1" for dry-run mode
  KM_MONITOR_ALL_ADAPTERS          Set to "1" to use all v1.1.0 named LLM adapters
  KM_MONITOR_EXTENDED_ADAPTERS     Set to "1" to use all v1.2.0 adapters (incl. Grok, Perplexity, DeepSeek, Cohere)
  KM_MONITOR_EXTRACTION_MODEL      LLM model for gold extraction (default: gpt-4.1-mini)
  KM_MONITOR_STATE_PATH            Override state file path
  KM_MONITOR_KM_DIR                Override KM output directory
  KM_MONITOR_NOTIFY_FILE           Path to NDJSON notification log
  KM_MONITOR_NOTIFY_WEBHOOK_URL    Webhook URL (Discord/Slack/custom)
  KM_MONITOR_WEBHOOK_BUFFER        Path to incoming webhook buffer file
  KM_MONITOR_WEBHOOK_PORT          Port for the webhook server (default: 7842)
  KM_MONITOR_WEBHOOK_SECRET        Shared secret for webhook authentication
  KM_MONITOR_HEALTH_INTERVAL       Cycles between health reports (default: 10)

Supported LLM sources (for --source filter):
  openai-chatgpt, anthropic-claude, google-gemini, mistral, meta-llama,
  cohere, xai-grok, perplexity, deepseek, openclaw-session, custom-webhook
`);
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error("[km-monitor] Fatal error:", err);
  process.exit(1);
});
