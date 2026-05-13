import type { DownsizePhotoAnalysis, PhotoQualityFlag } from "./types";

const MAX_ANALYSIS_DIM = 384;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function computeLaplacianVariance(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const c = gray[idx] ?? 0;
      const up = gray[idx - width] ?? 0;
      const down = gray[idx + width] ?? 0;
      const left = gray[idx - 1] ?? 0;
      const right = gray[idx + 1] ?? 0;
      const lap = -4 * c + up + down + left + right;
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const meanSq = sumSq / count;
  return meanSq - mean * mean;
}

export async function analyzePhoto(blob: Blob): Promise<DownsizePhotoAnalysis> {
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;

  const scale = Math.min(1, MAX_ANALYSIS_DIM / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return { width, height, brightness: 0, blurVariance: 0, flags: [] };
  }

  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const data = ctx.getImageData(0, 0, targetW, targetH).data;
  const gray = new Uint8Array(targetW * targetH);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    // sRGB luma approximation
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    gray[p] = y;
    sum += y;
  }
  const brightness = sum / Math.max(1, gray.length);
  const blurVariance = computeLaplacianVariance(gray, targetW, targetH);

  const flags: PhotoQualityFlag[] = [];
  if (brightness < 80) flags.push("too_dark");
  if (brightness > 190) flags.push("too_bright");
  if (blurVariance < 90) flags.push("blurry");

  return {
    width,
    height,
    brightness: clamp(Math.round(brightness), 0, 255),
    blurVariance: Math.max(0, Math.round(blurVariance)),
    flags,
  };
}

