import type { PriceStrategy } from "./types";

export type PriceSuggestion = {
  suggested: number;
  low: number;
  high: number;
  confidence: number; // 0..1
  usedComps: number[];
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const clamped = Math.min(1, Math.max(0, p));
  const idx = (sorted.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  const t = idx - lo;
  return a + (b - a) * t;
}

export function parseComps(raw: string): number[] {
  const parts = raw
    .split(/[\s,;|]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
  const values: number[] = [];
  for (const token of parts) {
    const num = Number(token.replace(/^\$/, ""));
    if (!Number.isFinite(num)) continue;
    if (num <= 0) continue;
    values.push(num);
  }
  return values;
}

export function suggestPrice(comps: number[], strategy: PriceStrategy): PriceSuggestion | null {
  const clean = comps
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Number(v))
    .sort((a, b) => a - b);
  if (clean.length === 0) return null;

  const q1 = quantile(clean, 0.25);
  const q3 = quantile(clean, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const filtered = clean.filter((v) => v >= loFence && v <= hiFence);
  const used = filtered.length >= 3 ? filtered : clean;

  const median = quantile(used, 0.5);
  const low = quantile(used, 0.25);
  const high = quantile(used, 0.75);
  const max = used[used.length - 1] ?? median;

  let suggested = median;
  if (strategy === "sell_fast") {
    suggested = median * 0.85;
  } else if (strategy === "maximize") {
    // Aim toward the top of recent comps while still capping runaway asks.
    suggested = Math.min(max, median * 1.2);
  }

  const confidence = clamp01(Math.log10(used.length + 1) / Math.log10(12 + 1));

  return {
    suggested: roundMoney(suggested),
    low: roundMoney(low),
    high: roundMoney(high),
    confidence,
    usedComps: used,
  };
}
