export type DownsizeItemStatus = "pending" | "in_progress" | "exported";

export type PriceStrategy = "sell_fast" | "balanced" | "maximize";

export type Condition =
  | "new"
  | "like_new"
  | "good"
  | "fair"
  | "for_parts"
  | "unknown";

export type PhotoQualityFlag = "blurry" | "too_dark" | "too_bright";

export type DownsizePhotoAnalysis = {
  width: number;
  height: number;
  brightness: number; // 0-255
  blurVariance: number;
  flags: PhotoQualityFlag[];
};

export type DownsizePhoto = {
  id: string;
  createdAtMs: number;
  mime: string;
  blob: Blob;
  analysis: DownsizePhotoAnalysis;
};

export type DownsizeItem = {
  id: string;
  createdAtMs: number;
  updatedAtMs: number;
  status: DownsizeItemStatus;

  title: string;
  department: string;
  category: string;
  condition: Condition;

  strategy: PriceStrategy;
  comps: number[];
  suggestedPrice: number | null;
  price: number | null;

  notes: string;
  photos: DownsizePhoto[];
};

export type DownsizeExportRow = {
  id: string;
  status: DownsizeItemStatus;
  createdAtIso: string;
  updatedAtIso: string;
  title: string;
  department: string;
  category: string;
  condition: Condition;
  strategy: PriceStrategy;
  suggestedPrice: string;
  price: string;
  comps: string;
  notes: string;
  photoCount: string;
  photoFlags: string;
};

