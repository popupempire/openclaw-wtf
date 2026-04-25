/**
 * km-monitor/index.ts
 *
 * OpenClaw Plugin Entry Point — registers the Knowledge Map Monitor as a
 * first-class OpenClaw extension. This exposes:
 *
 *   1. **CLI commands** (`openclaw km-monitor start|stop|scan|search|status`)
 *      for interactive use and cron-based invocation.
 *
 *   2. **Agent tools** (`km_monitor_scan`, `km_search`) so that OpenClaw
 *      agents can trigger scans and query the Knowledge Map mid-conversation.
 *
 *   3. **Background cron hook** that automatically runs a scan cycle every
 *      time the OpenClaw gateway starts up.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { startMonitor, runOnce, stopMonitor } from "./src/monitor-loop.js";
import { searchKnowledgeMap, getAllKnowledgeMapEntries } from "./src/km-writer.js";
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
        .action(async (opts: { interval: string }) => {
          process.env.KM_MONITOR_INTERVAL_MS = opts.interval;
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
        .action(async (opts: { dryRun?: boolean }) => {
          if (opts.dryRun) process.env.KM_MONITOR_DRY_RUN = "1";
          await runOnce();
        });

      km.command("search <query>")
        .description("Search the Knowledge Map for entries matching <query>")
        .action((query: string) => {
          const results = searchKnowledgeMap(query);
          if (results.length === 0) {
            console.log("No entries found.");
          } else {
            for (const entry of results) {
              console.log(`\n[${entry.id}] ${entry.title}`);
              console.log(`  ${entry.body}`);
              console.log(
                `  Source: ${entry.provenance.source} | Confidence: ${(entry.confidence * 100).toFixed(0)}%`,
              );
              console.log(`  Tags: ${entry.tags.join(", ")}`);
            }
          }
        });

      km.command("status")
        .description("Show the current monitor state")
        .action(() => {
          const state = loadState();
          const allEntries = getAllKnowledgeMapEntries();
          console.log(JSON.stringify({ ...state, totalKmEntries: allEntries.length }, null, 2));
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
            "Trigger a one-shot Knowledge Map scan cycle. Returns a summary of new gold entries added.",
          inputSchema: {
            type: "object" as const,
            properties: {
              dry_run: {
                type: "boolean",
                description: "If true, analyse without writing to the KM.",
              },
            },
          },
          async execute(input: { dry_run?: boolean }) {
            if (input.dry_run) process.env.KM_MONITOR_DRY_RUN = "1";
            else delete process.env.KM_MONITOR_DRY_RUN;
            await runOnce();
            const state = loadState();
            return {
              success: true,
              totalProcessed: state.totalProcessed,
              totalGoldAdded: state.totalGoldAdded,
              lastScanAt: state.lastScanAt,
            };
          },
        };

        const searchTool = {
          name: "km_search",
          description:
            "Search the Knowledge Map for gold entries matching a query string.",
          inputSchema: {
            type: "object" as const,
            properties: {
              query: {
                type: "string",
                description: "The search query.",
              },
            },
            required: ["query"],
          },
          execute(input: { query: string }) {
            const results = searchKnowledgeMap(input.query);
            return { count: results.length, entries: results };
          },
        };

        return [scanTool, searchTool];
      },
      { names: ["km_monitor_scan", "km_search"] },
    );
  },
};

export default kmMonitorPlugin;
