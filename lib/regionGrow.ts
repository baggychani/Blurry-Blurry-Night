/**
 * Fast tap-to-subject mask extraction.
 *
 * This is still intentionally lightweight, but it is less brittle than a
 * single seed-pixel RGB threshold: it samples local color variance around the
 * tap, adapts the threshold, blocks obvious luma/color jumps, and closes small
 * holes before producing a soft mask for depth-guided compositing.
 */

export interface RegionMask {
  data: Uint8Array;
  softData: Uint8Array;
  width: number;
  height: number;
}

const WORK_MAX_EDGE = 640;
const BASE_COLOR_DIST_THRESHOLD = 38;
const BASE_LUMA_DIST_THRESHOLD = 42;
const MAX_REGION_RATIO = 0.5;
const MIN_REGION_RATIO = 0.002;

type SeedStats = {
  r: number;
  g: number;
  b: number;
  luma: number;
  colorThreshold: number;
  lumaThreshold: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function sampleSeedStats(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number
): SeedStats {
  const radius = 3;
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumL = 0;
  let sumL2 = 0;

  for (let y = sy - radius; y <= sy + radius; y++) {
    if (y < 0 || y >= h) continue;
    for (let x = sx - radius; x <= sx + radius; x++) {
      if (x < 0 || x >= w) continue;
      const base = (y * w + x) * 4;
      const r = pixels[base];
      const g = pixels[base + 1];
      const b = pixels[base + 2];
      const luma = getLuma(r, g, b);
      count++;
      sumR += r;
      sumG += g;
      sumB += b;
      sumL += luma;
      sumL2 += luma * luma;
    }
  }

  const safeCount = Math.max(1, count);
  const meanLuma = sumL / safeCount;
  const variance = Math.max(0, sumL2 / safeCount - meanLuma * meanLuma);
  const localStd = Math.sqrt(variance);

  return {
    r: sumR / safeCount,
    g: sumG / safeCount,
    b: sumB / safeCount,
    luma: meanLuma,
    colorThreshold: clamp(BASE_COLOR_DIST_THRESHOLD + localStd * 1.45, 34, 72),
    lumaThreshold: clamp(BASE_LUMA_DIST_THRESHOLD + localStd * 1.2, 36, 74),
  };
}

function colorDistance(
  r: number,
  g: number,
  b: number,
  targetR: number,
  targetG: number,
  targetB: number
): number {
  const dr = r - targetR;
  const dg = g - targetG;
  const db = b - targetB;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function growWithThresholds(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  stats: SeedStats,
  looseness: number
): { mask: Uint8Array; count: number } {
  const mask = new Uint8Array(w * h);
  const visited = new Uint8Array(w * h);
  const maxPixels = Math.floor(w * h * MAX_REGION_RATIO);
  const queue = new Int32Array(w * h);
  const colorLimit = stats.colorThreshold * looseness;
  const lumaLimit = stats.lumaThreshold * looseness;
  const stepColorLimit = 34 * looseness;
  const stepLumaLimit = 30 * looseness;

  let qHead = 0;
  let qTail = 0;
  let count = 0;

  const enqueue = (idx: number) => {
    if (!visited[idx]) {
      visited[idx] = 1;
      queue[qTail++] = idx;
    }
  };

  const accepted = (idx: number, fromIdx: number): boolean => {
    const base = idx * 4;
    const r = pixels[base];
    const g = pixels[base + 1];
    const b = pixels[base + 2];
    const luma = getLuma(r, g, b);

    if (colorDistance(r, g, b, stats.r, stats.g, stats.b) > colorLimit) {
      return false;
    }
    if (Math.abs(luma - stats.luma) > lumaLimit) {
      return false;
    }

    const fromBase = fromIdx * 4;
    const pr = pixels[fromBase];
    const pg = pixels[fromBase + 1];
    const pb = pixels[fromBase + 2];
    const pluma = getLuma(pr, pg, pb);

    return (
      colorDistance(r, g, b, pr, pg, pb) <= stepColorLimit &&
      Math.abs(luma - pluma) <= stepLumaLimit
    );
  };

  const seedIdx = sy * w + sx;
  enqueue(seedIdx);

  while (qHead < qTail && count < maxPixels) {
    const idx = queue[qHead++];
    const x = idx % w;
    const y = (idx / w) | 0;

    if (idx !== seedIdx && !accepted(idx, idx)) continue;

    mask[idx] = 1;
    count++;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (!visited[nIdx] && accepted(nIdx, idx)) enqueue(nIdx);
      }
    }
  }

  return { mask, count };
}

function dilateMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx]) {
        out[idx] = 1;
        continue;
      }
      let hasNeighbor = false;
      for (let dy = -1; dy <= 1 && !hasNeighbor; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          if (mask[ny * w + nx]) {
            hasNeighbor = true;
            break;
          }
        }
      }
      out[idx] = hasNeighbor ? 1 : 0;
    }
  }
  return out;
}

function erodeMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let allNeighbors = true;
      for (let dy = -1; dy <= 1 && allNeighbors; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || !mask[ny * w + nx]) {
            allNeighbors = false;
            break;
          }
        }
      }
      out[y * w + x] = allNeighbors ? 1 : 0;
    }
  }
  return out;
}

function closeMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  return erodeMask(dilateMask(mask, w, h), w, h);
}

function countMaskPixels(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    count += mask[i];
  }
  return count;
}

export function growRegionFromPoint(
  image: HTMLImageElement,
  xRatio: number,
  yRatio: number
): RegionMask {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const longEdge = Math.max(W, H);
  const scale = longEdge > WORK_MAX_EDGE ? WORK_MAX_EDGE / longEdge : 1;
  const pw = Math.max(1, Math.round(W * scale));
  const ph = Math.max(1, Math.round(H * scale));

  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, pw, ph);
  const pixels = ctx.getImageData(0, 0, pw, ph).data;

  const sx = Math.max(0, Math.min(pw - 1, Math.round(xRatio * (pw - 1))));
  const sy = Math.max(0, Math.min(ph - 1, Math.round(yRatio * (ph - 1))));
  const stats = sampleSeedStats(pixels, pw, ph, sx, sy);
  const minPixels = Math.max(24, Math.floor(pw * ph * MIN_REGION_RATIO));

  let grown = growWithThresholds(pixels, pw, ph, sx, sy, stats, 1);
  if (grown.count < minPixels) {
    grown = growWithThresholds(pixels, pw, ph, sx, sy, stats, 1.35);
  }

  const closed = closeMask(grown.mask, pw, ph);
  const finalMask = countMaskPixels(closed) > 0 ? closed : grown.mask;
  return {
    data: finalMask,
    softData: softBlurMask(finalMask, pw, ph, 7),
    width: pw,
    height: ph,
  };
}

function softBlurMask(
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number
): Uint8Array {
  const size = w * h;
  const tmp = new Float32Array(size);
  const tap = radius * 2 + 1;

  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      const nx = clamp(x, 0, w - 1);
      sum += mask[y * w + nx];
    }

    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / tap;
      const removeX = clamp(x - radius, 0, w - 1);
      const addX = clamp(x + radius + 1, 0, w - 1);
      sum += mask[y * w + addX] - mask[y * w + removeX];
    }
  }

  const out = new Uint8Array(size);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      const ny = clamp(y, 0, h - 1);
      sum += tmp[ny * w + x];
    }

    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round((sum / tap) * 255);
      const removeY = clamp(y - radius, 0, h - 1);
      const addY = clamp(y + radius + 1, 0, h - 1);
      sum += tmp[addY * w + x] - tmp[removeY * w + x];
    }
  }

  return out;
}
