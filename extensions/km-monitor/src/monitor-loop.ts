/**
 * km-monitor/src/monitor-loop.ts
 *
 * Monitor Loop — the top-level orchestrator that ties together the scanner,
 * extractor, KM writer, and notifier into a single continuous monitoring cycle.
 *
 * The loop runs on a configurable interval (default: 60 seconds) and can also
 * be triggered manually for a single one-shot scan.
 *
 * Environment variables:
 *   KM_MONITOR_INTERVAL_MS   — polling interval in milliseconds (default: 60000)
 *   KM_MONITOR_CONFIDENCE    — minimum confidence threshold for gold entries (default: 0.6)
 *   KM_MONITOR_DRY_RUN       — if "1", skip writing to KM and sending notifications
 */

import { loadState, saveState, markSeen } from "./state.js";
import { runScanCycle, createAdapters } from "./scanner.js";
import { extractGoldEntries } from "./extractor.js";
import { writeToKnowledgeMap } from "./km-writer.js";
import { dispatchNotification } from "./notifier.js";
import type { MonitorState, GoldEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getIntervalMs(): number {
  const raw = process.env.KM_MONITOR_INTERVAL_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return isNaN(parsed) ? 60_000 : parsed;
}

function getConfidenceThreshold(): number {
  const raw = process.env.KM_MONITOR_CONFIDENCE;
  const parsed = raw ? parseFloat(raw) : NaN;
  return isNaN(parsed) ? 0.6 : Math.min(1, Math.max(0, parsed));
}

function isDryRun(): boolean {
  return process.env.KM_MONITOR_DRY_RUN === "1";
}

// ---------------------------------------------------------------------------
// Single scan cycle
// ---------------------------------------------------------------------------

/**
 * Execute one full monitoring cycle:
 *   1. Scan all adapters for new conversations.
 *   2. Extract gold entries from each new conversation.
 *   3. Write entries to the Knowledge Map.
 *   4. Dispatch notifications.
 *   5. Persist updated state.
 *
 * @returns The updated MonitorState after this cycle.
 */
export async function runOneCycle(state: MonitorState): Promise<MonitorState> {
  const adapters = createAdapters();
  const confidenceThreshold = getConfidenceThreshold();
  const dryRun = isDryRun();

  console.log(
    `[km-monitor] Starting scan cycle at ${new Date().toISOString()} (dry-run: ${dryRun})`,
  );

  // --- Step 1: Scan ---
  const { newConversations, adaptersQueried, errors: scanErrors } =
    await runScanCycle(adapters, state);

  console.log(
    `[km-monitor] Scanned ${adaptersQueried} adapter(s). Found ${newConversations.length} new conversation(s). Errors: ${scanErrors.length}.`,
  );

  if (scanErrors.length > 0) {
    for (const e of scanErrors) {
      console.warn(`[km-monitor] Adapter error [${e.adapter}]: ${e.error}`);
    }
  }

  // --- Step 2: Extract ---
  const allGoldEntries: GoldEntry[] = [];

  for (const conversation of newConversations) {
    console.log(
      `[km-monitor] Extracting gold from conversation ${conversation.id} (source: ${conversation.source})…`,
    );
    const { entries, rawCandidateCount, rejectedCount } =
      await extractGoldEntries(conversation, confidenceThreshold);

    console.log(
      `[km-monitor]   → ${rawCandidateCount} candidate(s), ${rejectedCount} rejected, ${entries.length} accepted.`,
    );

    allGoldEntries.push(...entries);

    // Update state to mark this conversation as seen.
    state = markSeen(state, conversation.source, conversation.id);
  }

  // --- Step 3: Write to KM ---
  if (!dryRun && allGoldEntries.length > 0) {
    const writeResult = writeToKnowledgeMap(allGoldEntries);
    console.log(
      `[km-monitor] KM write: ${writeResult.written} written, ${writeResult.duplicatesSkipped} duplicates skipped.`,
    );
    console.log(`[km-monitor] Markdown log: ${writeResult.markdownLogPath}`);
    console.log(`[km-monitor] JSON index:   ${writeResult.jsonIndexPath}`);
  }

  // --- Step 4: Notify ---
  if (!dryRun) {
    await dispatchNotification(allGoldEntries, scanErrors);
  }

  // --- Step 5: Persist state ---
  const updatedState: MonitorState = {
    ...state,
    totalProcessed: state.totalProcessed + newConversations.length,
    totalGoldAdded: state.totalGoldAdded + allGoldEntries.length,
    lastScanAt: new Date().toISOString(),
  };

  if (!dryRun) {
    saveState(updatedState);
  }

  console.log(
    `[km-monitor] Cycle complete. Total processed: ${updatedState.totalProcessed}, total gold: ${updatedState.totalGoldAdded}.`,
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

  console.log(
    `[km-monitor] Starting continuous monitor (interval: ${intervalMs}ms)…`,
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
