import type { DownsizeExportRow, DownsizeItem } from "./types";

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function itemsToExportRows(items: DownsizeItem[]): DownsizeExportRow[] {
  return items.map((item) => {
    const createdAtIso = new Date(item.createdAtMs).toISOString();
    const updatedAtIso = new Date(item.updatedAtMs).toISOString();
    const suggestedPrice = item.suggestedPrice == null ? "" : String(item.suggestedPrice);
    const price = item.price == null ? "" : String(item.price);
    const comps = item.comps.length ? item.comps.join("|") : "";
    const photoFlags = Array.from(
      new Set(item.photos.flatMap((p) => p.analysis.flags)),
    ).join("|");
    return {
      id: item.id,
      status: item.status,
      createdAtIso,
      updatedAtIso,
      title: item.title,
      department: item.department,
      category: item.category,
      condition: item.condition,
      strategy: item.strategy,
      suggestedPrice,
      price,
      comps,
      notes: item.notes,
      photoCount: String(item.photos.length),
      photoFlags,
    };
  });
}

export function exportRowsToCsv(rows: DownsizeExportRow[]): string {
  const headers: Array<keyof DownsizeExportRow> = [
    "id",
    "status",
    "createdAtIso",
    "updatedAtIso",
    "title",
    "department",
    "category",
    "condition",
    "strategy",
    "suggestedPrice",
    "price",
    "comps",
    "notes",
    "photoCount",
    "photoFlags",
  ];
  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    const values = headers.map((key) => csvEscape(String(row[key] ?? "")));
    lines.push(values.join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function itemsToCsv(items: DownsizeItem[]): string {
  return exportRowsToCsv(itemsToExportRows(items));
}

