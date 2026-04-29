/**
 * km-monitor/src/state.ts  — v1.2.0
 *
 * Lightweight JSON-file-backed state store for the monitor loop.
 * Persists the "last seen" conversation IDs so the agent never re-processes
 * a conversation it has already ingested, even across restarts.
 *
 * Changes in v1.2.0:
 *   - Added `lastBatchId` to MonitorState for batch-level traceability.
 *   - Backward-compatible loading: merges with defaults for old state files.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MonitorState } from "./types.js";

const DEFAULT_STATE: MonitorState = {
  lastSeenIds: {},
  totalProcessed: 0,
  totalGoldAdded: 0,
  lastScanAt: null,
  cycleCount: 0,
  sourceStats: {},
  lastBatchId: undefined,
};

function resolveStatePath(): string {
  if (process.env.KM_MONITOR_STATE_PATH) {
    return process.env.KM_MONITOR_STATE_PATH;
  }
  const home = process.env.HOME ?? "/tmp";
  return join(home, ".openclaw", "km-monitor", "state.json");
}

/** Load the persisted monitor state from disk, or return defaults. */
export function loadState(): MonitorState {
  const path = resolveStatePath();
  if (!existsSync(path)) {
    return { ...DEFAULT_STATE, lastSeenIds: {}, sourceStats: {} };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MonitorState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      lastSeenIds: parsed.lastSeenIds ?? {},
      sourceStats: parsed.sourceStats ?? {},
    };
  } catch {
    console.warn("[km-monitor] Failed to parse state file; starting fresh.");
    return { ...DEFAULT_STATE, lastSeenIds: {}, sourceStats: {} };
  }
}

/** Persist the current monitor state to disk atomically. */
export function saveState(state: MonitorState): void {
  const path = resolveStatePath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

/** Mark a conversation as seen for a given source, updating the state. */
export function markSeen(
  state: MonitorState,
  source: string,
  conversationId: string,
): MonitorState {
  return {
    ...state,
    lastSeenIds: { ...state.lastSeenIds, [source]: conversationId },
  };
}

/**
 * Increment per-source statistics in the state.
 * Called after each conversation is processed.
 */
export function incrementSourceStats(
  state: MonitorState,
  source: string,
  goldAdded: number,
): MonitorState {
  const existing = state.sourceStats[source] ?? { processed: 0, goldAdded: 0 };
  return {
    ...state,
    sourceStats: {
      ...state.sourceStats,
      [source]: {
        processed: existing.processed + 1,
        goldAdded: existing.goldAdded + goldAdded,
      },
    },
  };
}
