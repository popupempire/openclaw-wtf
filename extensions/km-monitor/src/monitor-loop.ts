/**
 * km-monitor/src/monitor-loop.ts  — v1.2.0
 *
 * Core Monitor Loop — orchestrates the full scan-extract-write-notify pipeline.
 *
 * Changes in v1.2.0:
 *   - Added batch ID (UUID v4) per cycle for end-to-end traceability.
 *   - Added `KM_MONITOR_EXTENDED_ADAPTERS` env flag for the v1.2.0 adapter set.
 *   - Added periodic health report dispatch (every N cycles, configurable).
 *   - `runOneCycle()` now returns the batchId in the updated state.
 *   - Improved console logging with batch ID prefix.
 */
import { randomUUID } from "node:crypto";
import {
  createAdapters,
  createAllAdapters,
  createExtendedAdapters,
  runScanCycle,
} from "./scanner.js";
import { extractGoldEntries } from "./extractor.js";
import { writeToKnowledgeMap, getAllKnowledgeMapEntries, getKnowledgeMapStats } from "./km-writer.js";
import { dispatchNotification, dispatchHealthReport } from "./notifier.js";
import { loadState, saveState, markSeen, incrementSourceStats } from "./state.js";
import type { GoldEntry, ConversationRecord, MonitorState } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function getIntervalMs(): number {
  return parseInt(process.env.KM_MONITOR_INTERVAL_MS ?? "60000", 10);
}

function getConfidenceThreshold(): number {
  return parseFloat(process.env.KM_MONITOR_CONFIDENCE ?? "0.6");
}

function isDryRun(): boolean {
  return process.env.KM_MONITOR_DRY_RUN === "1";
}

function useAllAdapters(): boolean {
  return process.env.KM_MONITOR_ALL_ADAPTERS === "1";
}

function useExtendedAdapters(): boolean {
  return process.env.KM_MONITOR_EXTENDED_ADAPTERS === "1";
}

/** How often (in cycles) to emit a health report. Default: every 10 cycles. */
function getHealthReportInterval(): number {
  return parseInt(process.env.KM_MONITOR_HEALTH_INTERVAL ?? "10", 10);
}

function selectAdapters() {
  if (useExtendedAdapters()) return createExtendedAdapters();
  if (useAllAdapters()) return createAllAdapters();
  return createAdapters();
}

// ---------------------------------------------------------------------------
// Single Cycle
// ---------------------------------------------------------------------------

/**
 * Run one complete scan-extract-write-notify cycle.
 *
 * Steps:
 *   1. Assign a batch ID for end-to-end traceability.
 *   2. Scan all adapters for new conversations.
 *   3. Extract gold entries from each new conversation.
 *   4. Write entries to the Knowledge Map (with audit trail).
 *   5. Dispatch notifications (with per-source breakdown and batch ID).
 *   6. Optionally dispatch a health report.
 *   7. Persist updated state (with cycleCount, sourceStats, lastBatchId).
 *
 * @returns The updated MonitorState after this cycle.
 */
export async function runOneCycle(state: MonitorState): Promise<MonitorState> {
  const adapters = selectAdapters();
  const confidenceThreshold = getConfidenceThreshold();
  const dryRun = isDryRun();
  const cycleNumber = (state.cycleCount ?? 0) + 1;
  const batchId = randomUUID();

  console.log(
    `[km-monitor] ┌─ Cycle #${cycleNumber} | batch: ${batchId} | ${new Date().toISOString()} | dry-run: ${dryRun} | adapters: ${adapters.length}`,
  );

  // --- Step 1: Scan ---
  const { newConversations, adaptersQueried, errors: scanErrors } =
    await runScanCycle(adapters, state);

  console.log(
    `[km-monitor] ├─ Scanned ${adaptersQueried} adapter(s). New conversations: ${newConversations.length}. Errors: ${scanErrors.length}.`,
  );
  for (const e of scanErrors) {
    console.warn(`[km-monitor] │  ⚠ Adapter error [${e.adapter}]: ${e.error}`);
  }

  // --- Step 2: Extract ---
  const allGoldEntries: GoldEntry[] = [];
  const processedConversations: ConversationRecord[] = [];

  for (const conversation of newConversations) {
    console.log(
      `[km-monitor] ├─ Extracting: conv=${conversation.id} source=${conversation.source}`,
    );
    const { entries, rawCandidateCount, rejectedCount, model } =
      await extractGoldEntries(conversation, confidenceThreshold, batchId);
    console.log(
      `[km-monitor] │  model=${model} | candidates=${rawCandidateCount} | rejected=${rejectedCount} | accepted=${entries.length}`,
    );
    allGoldEntries.push(...entries);
    processedConversations.push(conversation);
    state = markSeen(state, conversation.source, conversation.id);
    state = incrementSourceStats(state, conversation.source, entries.length);
  }

  // --- Step 3: Write to KM ---
  if (!dryRun && allGoldEntries.length > 0) {
    const writeResult = writeToKnowledgeMap(allGoldEntries, batchId);
    console.log(
      `[km-monitor] ├─ KM write: written=${writeResult.written} | skipped=${writeResult.duplicatesSkipped}`,
    );
    console.log(`[km-monitor] │  md=${writeResult.markdownLogPath}`);
    console.log(`[km-monitor] │  json=${writeResult.jsonIndexPath}`);
    console.log(`[km-monitor] │  audit=${writeResult.auditLogPath}`);
  } else if (dryRun) {
    console.log(`[km-monitor] ├─ Dry-run: skipping KM write (${allGoldEntries.length} entries would be written).`);
  } else {
    console.log(`[km-monitor] ├─ No new gold entries to write.`);
  }

  // --- Step 4: Notify ---
  if (!dryRun) {
    await dispatchNotification(
      allGoldEntries,
      scanErrors,
      processedConversations,
      cycleNumber,
      batchId,
    );
  }

  // --- Step 5: Persist state ---
  const updatedState: MonitorState = {
    ...state,
    totalProcessed: state.totalProcessed + newConversations.length,
    totalGoldAdded: state.totalGoldAdded + allGoldEntries.length,
    lastScanAt: new Date().toISOString(),
    cycleCount: cycleNumber,
    lastBatchId: batchId,
  };
  if (!dryRun) {
    saveState(updatedState);
  }

  // --- Step 6: Periodic health report ---
  const healthInterval = getHealthReportInterval();
  if (!dryRun && cycleNumber % healthInterval === 0) {
    const allEntries = getAllKnowledgeMapEntries();
    await dispatchHealthReport({
      kind: "km-health",
      reportedAt: new Date().toISOString(),
      cycleCount: cycleNumber,
      totalProcessed: updatedState.totalProcessed,
      totalGoldEntries: allEntries.length,
      sourceStats: updatedState.sourceStats,
      monitorRunning: true,
      intervalMs: getIntervalMs(),
    });
  }

  console.log(
    `[km-monitor] └─ Cycle #${cycleNumber} complete. totalProcessed=${updatedState.totalProcessed} | totalGold=${updatedState.totalGoldAdded}`,
  );
  return updatedState;
}

// ---------------------------------------------------------------------------
// Continuous loop
// ---------------------------------------------------------------------------

let _running = false;

/**
 * Start the continuous monitoring loop.
 * Runs `runOneCycle` on the configured interval until `stopMonitor()` is called.
 */
export async function startMonitor(): Promise<void> {
  if (_running) {
    console.warn("[km-monitor] Monitor is already running.");
    return;
  }
  _running = true;
  let state = loadState();
  const intervalMs = getIntervalMs();
  const adapterMode = useExtendedAdapters() ? "extended" : useAllAdapters() ? "all" : "default";

  console.log(
    `[km-monitor] Starting continuous monitor | interval=${intervalMs}ms | adapters=${adapterMode} | confidence>=${getConfidenceThreshold()}`,
  );

  while (_running) {
    try {
      state = await runOneCycle(state);
    } catch (err) {
      console.error("[km-monitor] Unhandled error in scan cycle:", err);
    }
    if (_running) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  console.log("[km-monitor] Monitor stopped.");
}

/** Stop the continuous monitoring loop after the current cycle completes. */
export function stopMonitor(): void {
  _running = false;
}

/** Check whether the monitor is currently running. */
export function isMonitorRunning(): boolean {
  return _running;
}

// ---------------------------------------------------------------------------
// One-shot mode (for CLI / cron invocation)
// ---------------------------------------------------------------------------

/**
 * Run a single scan cycle and exit.
 * Useful when the monitor is invoked via cron rather than as a long-running daemon.
 */
export async function runOnce(): Promise<void> {
  const state = loadState();
  await runOneCycle(state);
}
