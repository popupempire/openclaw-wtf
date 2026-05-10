import { describe, expect, it } from "vitest";
import { itemsToCsv } from "./csv";
import type { DownsizeItem } from "./types";

function makeItem(overrides: Partial<DownsizeItem> = {}): DownsizeItem {
  const t = Date.UTC(2026, 0, 2, 3, 4, 5);
  return {
    id: "item-1",
    createdAtMs: t,
    updatedAtMs: t,
    status: "in_progress",
    title: 'Chair "oak", small',
    department: "Home",
    category: "Furniture",
    condition: "good",
    strategy: "balanced",
    comps: [10, 12],
    suggestedPrice: 11,
    price: null,
    notes: "Line1\nLine2",
    photos: [
      {
        id: "p1",
        createdAtMs: t,
        mime: "image/jpeg",
        blob: new Blob(["x"], { type: "image/jpeg" }),
        analysis: { width: 1, height: 1, brightness: 100, blurVariance: 120, flags: ["too_dark"] },
      },
    ],
    ...overrides,
  };
}

describe("downsize csv", () => {
  it("exports RFC4180-style quoted cells", () => {
    const csv = itemsToCsv([makeItem()]);
    expect(csv.split("\n")[0]).toContain("title,department,category");
    expect(csv).toContain('"Chair ""oak"", small"');
    expect(csv).toContain('"Line1\nLine2"');
  });
});

