/**
 * km-monitor/src/state.ts
 *
 * Lightweight JSON-file-backed state store for the monitor loop.
 * Persists the "last seen" conversation IDs so the agent never re-processes
 * a conversation it has already ingested, even across restarts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MonitorState } from "./types.js";

const DEFAULT_STATE: MonitorState = {
  lastSeenIds: {},
  totalProcessed: 0,
  totalGoldAdded: 0,
  lastScanAt: null,
};

/**
 * Resolve the path to the state file.
 * Defaults to `~/.openclaw/km-monitor/state.json` but can be overridden
 * via the `KM_MONITOR_STATE_PATH` environment variable.
 */
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
    return { ...DEFAULT_STATE, lastSeenIds: {} };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as MonitorState;
  } catch {
    console.warn("[km-monitor] Failed to parse state file; starting fresh.");
    return { ...DEFAULT_STATE, lastSeenIds: {} };
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
