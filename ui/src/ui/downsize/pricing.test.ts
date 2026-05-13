import { describe, expect, it } from "vitest";
import { parseComps, suggestPrice } from "./pricing";

describe("downsize pricing", () => {
  it("parses comps from mixed separators", () => {
    expect(parseComps(" $10, 20; 30 |  40 ")).toEqual([10, 20, 30, 40]);
    expect(parseComps("nope 0 -1 12.5")).toEqual([12.5]);
  });

  it("suggests a balanced median-based price", () => {
    const suggestion = suggestPrice([10, 12, 14, 16, 18], "balanced");
    expect(suggestion?.suggested).toBe(14);
    expect(suggestion?.low).toBe(12);
    expect(suggestion?.high).toBe(16);
  });

  it("filters outliers when enough comps exist", () => {
    const suggestion = suggestPrice([10, 11, 12, 13, 14, 250], "balanced");
    expect(suggestion?.usedComps.includes(250)).toBe(false);
    expect(suggestion?.suggested).toBe(12);
  });

  it("adjusts suggested price by strategy", () => {
    const comps = [20, 22, 24, 26, 28];
    expect(suggestPrice(comps, "sell_fast")?.suggested).toBe(20);
    expect(suggestPrice(comps, "balanced")?.suggested).toBe(24);
    expect(suggestPrice(comps, "maximize")?.suggested).toBe(28);
  });
});

