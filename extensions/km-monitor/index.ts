/**
 * km-monitor/index.ts  — v1.2.0
 *
 * OpenClaw Plugin Entry Point — registers the Knowledge Map Monitor as a
 * first-class OpenClaw extension.
 *
 * Changes in v1.2.0:
 *   - Added `--extended-adapters` flag to `start` and `scan` CLI commands.
 *   - Added `km_health` agent tool for live health reporting.
 *   - Added `km_get` agent tool for single-entry retrieval by ID.
 *   - `km_monitor_scan` now accepts `extended_adapters` option.
 *   - Plugin version bumped to 1.2.0.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import {
  startMonitor,
  runOnce,
  stopMonitor,
  isMonitorRunning,
} from "./src/monitor-loop.js";
import {
  searchKnowledgeMap,
  searchKnowledgeMapBySource,
  getAllKnowledgeMapEntries,
  getKnowledgeMapStats,
  getKnowledgeMapEntry,
} from "./src/km-writer.js";
import { loadState } from "./src/state.js";

const kmMonitorPlugin = {
  id: "km-monitor",
  name: "Knowledge Map Monitor",
  description:
    "Continuously monitors LLM interfaces for new conversations, enriches the Knowledge Map with verified 'gold' insights, and dispatches traceable notifications.",
  kind: "extension" as const,
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // -----------------------------------------------------------------------
    // CLI Commands
    // -----------------------------------------------------------------------
    api.registerCli(({ program }) => {
      const km = program
        .command("km-monitor")
        .description("Knowledge Map Monitor commands");

      km.command("start")
        .description("Start the continuous monitoring loop (blocks until Ctrl+C)")
        .option("--interval <ms>", "Polling interval in milliseconds", "60000")
        .option("--all-adapters", "Use all v1.1.0 named LLM adapters")
        .option("--extended-adapters", "Use all v1.2.0 adapters (incl. Grok, Perplexity, DeepSeek, Cohere)")
        .action(async (opts: { interval: string; allAdapters?: boolean; extendedAdapters?: boolean }) => {
          process.env.KM_MONITOR_INTERVAL_MS = opts.interval;
          if (opts.allAdapters) process.env.KM_MONITOR_ALL_ADAPTERS = "1";
          if (opts.extendedAdapters) process.env.KM_MONITOR_EXTENDED_ADAPTERS = "1";
          await startMonitor();
        });

      km.command("stop")
        .description("Signal the monitor loop to stop (no-op if not running)")
        .action(() => {
          stopMonitor();
          console.log("[km-monitor] Stop signal sent.");
        });

      km.command("scan")
        .description("Run a single scan cycle and exit")
        .option("--dry-run", "Analyse without writing to KM or notifying")
        .option("--all-adapters", "Use all v1.1.0 named LLM adapters")
        .option("--extended-adapters", "Use all v1.2.0 adapters")
        .action(async (opts: { dryRun?: boolean; allAdapters?: boolean; extendedAdapters?: boolean }) => {
          if (opts.dryRun) process.env.KM_MONITOR_DRY_RUN = "1";
          if (opts.allAdapters) process.env.KM_MONITOR_ALL_ADAPTERS = "1";
          if (opts.extendedAdapters) process.env.KM_MONITOR_EXTENDED_ADAPTERS = "1";
          await runOnce();
        });

      km.command("search <query>")
        .description("Search the Knowledge Map for entries matching <query>")
        .option("--source <source>", "Filter results by LLM source")
        .action((query: string, opts: { source?: string }) => {
          const results = opts.source
            ? searchKnowledgeMapBySource(opts.source).filter(
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
              console.log(`  Source: ${entry.provenance.source} | Confidence: ${(entry.confidence * 100).toFixed(0)}%`);
              if (entry.provenance.batchId) console.log(`  Batch: ${entry.provenance.batchId}`);
              console.log();
            }
          }
        });

      km.command("get <id>")
        .description("Retrieve a single KM entry by ID")
        .action((id: string) => {
          const entry = getKnowledgeMapEntry(id);
          if (!entry) {
            console.log(`Entry not found: ${id}`);
          } else {
            console.log(JSON.stringify(entry, null, 2));
          }
        });

      km.command("stats")
        .description("Show Knowledge Map statistics (entry counts, top tags, per-source breakdown)")
        .action(() => {
          const stats = getKnowledgeMapStats();
          console.log(JSON.stringify(stats, null, 2));
        });

      km.command("status")
        .description("Show current monitor state")
        .action(() => {
          const state = loadState();
          const allEntries = getAllKnowledgeMapEntries();
          console.log(
            JSON.stringify(
              { ...state, totalKmEntries: allEntries.length },
              null,
              2,
            ),
          );
        });

      km.command("health")
        .description("Print current health report")
        .action(() => {
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
            monitorRunning: isMonitorRunning(),
            kmStats: stats,
          }, null, 2));
        });
    }, { commands: ["km-monitor"] });

    // -----------------------------------------------------------------------
    // Agent Tools
    // -----------------------------------------------------------------------
    api.registerTool(
      () => {
        const scanTool = {
          name: "km_monitor_scan",
          description:
            "Trigger a one-shot Knowledge Map scan cycle across all configured LLM interfaces. Returns a summary of new gold entries added.",
          inputSchema: {
            type: "object" as const,
            properties: {
              dry_run: {
                type: "boolean",
                description: "If true, analyse without writing to the KM.",
              },
              all_adapters: {
                type: "boolean",
                description: "If true, use all v1.1.0 named LLM adapters.",
              },
              extended_adapters: {
                type: "boolean",
                description: "If true, use all v1.2.0 adapters (incl. Grok, Perplexity, DeepSeek, Cohere).",
              },
            },
          },
          async execute(input: { dry_run?: boolean; all_adapters?: boolean; extended_adapters?: boolean }) {
            if (input.dry_run) process.env.KM_MONITOR_DRY_RUN = "1";
            else delete process.env.KM_MONITOR_DRY_RUN;
            if (input.extended_adapters) process.env.KM_MONITOR_EXTENDED_ADAPTERS = "1";
            else delete process.env.KM_MONITOR_EXTENDED_ADAPTERS;
            if (input.all_adapters) process.env.KM_MONITOR_ALL_ADAPTERS = "1";
            else delete process.env.KM_MONITOR_ALL_ADAPTERS;
            await runOnce();
            const state = loadState();
            const stats = getKnowledgeMapStats();
            return {
              success: true,
              totalProcessed: state.totalProcessed,
              totalGoldAdded: state.totalGoldAdded,
              lastScanAt: state.lastScanAt,
              cycleCount: state.cycleCount,
              lastBatchId: state.lastBatchId,
              sourceStats: state.sourceStats,
              kmStats: stats,
            };
          },
        };

        const searchTool = {
          name: "km_search",
          description:
            "Search the Knowledge Map for gold entries matching a query string. Optionally filter by LLM source.",
          inputSchema: {
            type: "object" as const,
            properties: {
              query: { type: "string", description: "The search query." },
              source: {
                type: "string",
                description: "Optional: filter to a specific LLM source.",
              },
            },
            required: ["query"],
          },
          execute(input: { query: string; source?: string }) {
            const results = input.source
              ? searchKnowledgeMapBySource(input.source).filter(
                  (e) =>
                    e.title.toLowerCase().includes(input.query.toLowerCase()) ||
                    e.body.toLowerCase().includes(input.query.toLowerCase()),
                )
              : searchKnowledgeMap(input.query);
            return { count: results.length, entries: results };
          },
        };

        const listTool = {
          name: "km_list",
          description:
            "List all entries in the Knowledge Map. Optionally filter by LLM source. Returns entries with full provenance metadata.",
          inputSchema: {
            type: "object" as const,
            properties: {
              source: { type: "string", description: "Optional: filter to a specific LLM source." },
              limit: { type: "number", description: "Maximum number of entries to return (default: 50)." },
            },
          },
          execute(input: { source?: string; limit?: number }) {
            const limit = input.limit ?? 50;
            const all = input.source
              ? searchKnowledgeMapBySource(input.source)
              : getAllKnowledgeMapEntries();
            const entries = all.slice(-limit);
            const stats = getKnowledgeMapStats();
            return { total: all.length, returned: entries.length, stats, entries };
          },
        };

        const getTool = {
          name: "km_get",
          description: "Retrieve a single Knowledge Map entry by its UUID.",
          inputSchema: {
            type: "object" as const,
            properties: {
              id: { type: "string", description: "The UUID of the KM entry." },
            },
            required: ["id"],
          },
          execute(input: { id: string }) {
            const entry = getKnowledgeMapEntry(input.id);
            return entry ? { found: true, entry } : { found: false };
          },
        };

        const healthTool = {
          name: "km_health",
          description:
            "Return a live health report for the Knowledge Map Monitor: cycle count, total processed, gold entries, per-source stats, and monitor status.",
          inputSchema: { type: "object" as const, properties: {} },
          execute(_input: Record<string, never>) {
            const state = loadState();
            const allEntries = getAllKnowledgeMapEntries();
            const stats = getKnowledgeMapStats();
            return {
              kind: "km-health",
              reportedAt: new Date().toISOString(),
              cycleCount: state.cycleCount,
              totalProcessed: state.totalProcessed,
              totalGoldEntries: allEntries.length,
              sourceStats: state.sourceStats,
              lastScanAt: state.lastScanAt,
              lastBatchId: state.lastBatchId,
              monitorRunning: isMonitorRunning(),
              kmStats: stats,
            };
          },
        };

        return [scanTool, searchTool, listTool, getTool, healthTool];
      },
      { names: ["km_monitor_scan", "km_search", "km_list", "km_get", "km_health"] },
    );
  },
};

export default kmMonitorPlugin;
