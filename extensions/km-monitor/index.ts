/**
 * km-monitor/index.ts
 *
 * OpenClaw Plugin Entry Point — registers the Knowledge Map Monitor as a
 * first-class OpenClaw extension. This exposes:
 *
 *   1. **CLI commands** (`openclaw km-monitor start|stop|scan|search|status|stats`)
 *      for interactive use and cron-based invocation.
 *
 *   2. **Agent tools** (`km_monitor_scan`, `km_search`, `km_list`) so that OpenClaw
 *      agents can trigger scans and query the Knowledge Map mid-conversation.
 *
 *   3. **Background cron hook** that automatically runs a scan cycle every
 *      time the OpenClaw gateway starts up.
 *
 * Enhanced in v1.1.0:
 *   - Added `--all-adapters` flag to `start` and `scan` commands.
 *   - Added `stats` CLI command for KM statistics.
 *   - Added `km_list` agent tool to list all KM entries (with optional source filter).
 *   - Status command now includes cycleCount and sourceStats.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { startMonitor, runOnce, stopMonitor } from "./src/monitor-loop.js";
import {
  searchKnowledgeMap,
  searchKnowledgeMapBySource,
  getAllKnowledgeMapEntries,
  getKnowledgeMapStats,
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
        .option(
          "--all-adapters",
          "Use all named LLM adapters (ChatGPT, Claude, Gemini, Mistral, etc.)",
        )
        .action(async (opts: { interval: string; allAdapters?: boolean }) => {
          process.env.KM_MONITOR_INTERVAL_MS = opts.interval;
          if (opts.allAdapters) process.env.KM_MONITOR_ALL_ADAPTERS = "1";
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
        .option(
          "--all-adapters",
          "Use all named LLM adapters (ChatGPT, Claude, Gemini, Mistral, etc.)",
        )
        .action(async (opts: { dryRun?: boolean; allAdapters?: boolean }) => {
          if (opts.dryRun) process.env.KM_MONITOR_DRY_RUN = "1";
          if (opts.allAdapters) process.env.KM_MONITOR_ALL_ADAPTERS = "1";
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
              console.log(`\n[${entry.id}] ${entry.title}`);
              console.log(`  ${entry.body}`);
              console.log(
                `  Source: ${entry.provenance.source} | Confidence: ${(entry.confidence * 100).toFixed(0)}%`,
              );
              console.log(`  Tags: ${entry.tags.join(", ")}`);
              console.log(
                `  Conv: ${entry.provenance.conversationId}${entry.provenance.originUrl ? ` | URL: ${entry.provenance.originUrl}` : ""}`,
              );
            }
          }
        });

      km.command("status")
        .description("Show the current monitor state")
        .action(() => {
          const state = loadState();
          const allEntries = getAllKnowledgeMapEntries();
          console.log(
            JSON.stringify(
              {
                ...state,
                totalKmEntries: allEntries.length,
              },
              null,
              2,
            ),
          );
        });

      km.command("stats")
        .description("Show Knowledge Map statistics (entry counts, top tags, per-source breakdown)")
        .action(() => {
          const stats = getKnowledgeMapStats();
          console.log(JSON.stringify(stats, null, 2));
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
                description:
                  "If true, use all named LLM adapters (ChatGPT, Claude, Gemini, Mistral, etc.).",
              },
            },
          },
          async execute(input: { dry_run?: boolean; all_adapters?: boolean }) {
            if (input.dry_run) process.env.KM_MONITOR_DRY_RUN = "1";
            else delete process.env.KM_MONITOR_DRY_RUN;
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
              query: {
                type: "string",
                description: "The search query.",
              },
              source: {
                type: "string",
                description:
                  "Optional: filter results to a specific LLM source (e.g., 'openai-chatgpt', 'anthropic-claude').",
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
              source: {
                type: "string",
                description:
                  "Optional: filter to a specific LLM source (e.g., 'openai-chatgpt', 'anthropic-claude', 'google-gemini', 'mistral').",
              },
              limit: {
                type: "number",
                description: "Maximum number of entries to return (default: 50).",
              },
            },
          },
          execute(input: { source?: string; limit?: number }) {
            const limit = input.limit ?? 50;
            const all = input.source
              ? searchKnowledgeMapBySource(input.source)
              : getAllKnowledgeMapEntries();
            const entries = all.slice(-limit); // most recent N entries
            const stats = getKnowledgeMapStats();
            return {
              total: all.length,
              returned: entries.length,
              stats,
              entries,
            };
          },
        };

        return [scanTool, searchTool, listTool];
      },
      { names: ["km_monitor_scan", "km_search", "km_list"] },
    );
  },
};

export default kmMonitorPlugin;
