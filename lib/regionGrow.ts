/**
 * regionGrow.ts
 *
 * 탭한 좌표를 시드로, 색상+밝기 유사성을 기준으로 BFS 영역 확장.
 * 최대 WORK_MAX_EDGE px로 다운스케일해서 연산하므로 4K 이미지에서도 빠르게 동작.
 */

export interface RegionMask {
  data: Uint8Array; // 1 = 선택 영역, 0 = 배경
  width: number;
  height: number;
}

const WORK_MAX_EDGE = 512;
const COLOR_DIST_THRESHOLD = 45; // 0-441 범위, RGB 유클리드 거리
const LUMA_DIST_THRESHOLD = 50;  // 시드 밝기와의 절대 차이
const MAX_REGION_RATIO = 0.45;   // 이미지 전체 픽셀 대비 최대 영역 비율

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

  const seedBase = (sy * pw + sx) * 4;
  const seedR = pixels[seedBase];
  const seedG = pixels[seedBase + 1];
  const seedB = pixels[seedBase + 2];
  const seedLuma = 0.299 * seedR + 0.587 * seedG + 0.114 * seedB;

  const mask = new Uint8Array(pw * ph);
  const visited = new Uint8Array(pw * ph);
  const maxPixels = Math.floor(pw * ph * MAX_REGION_RATIO);

  // Int32Array를 circular buffer로 사용 → O(1) enqueue/dequeue
  const queue = new Int32Array(pw * ph);
  let qHead = 0;
  let qTail = 0;
  let count = 0;

  const enqueue = (idx: number) => {
    if (!visited[idx]) {
      visited[idx] = 1;
      queue[qTail++] = idx;
    }
  };

  enqueue(sy * pw + sx);

  while (qHead < qTail && count < maxPixels) {
    const idx = queue[qHead++];
    const x = idx % pw;
    const y = (idx / pw) | 0;
    const pixBase = idx * 4;

    const r = pixels[pixBase];
    const g = pixels[pixBase + 1];
    const b = pixels[pixBase + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;

    const dr = r - seedR;
    const dg = g - seedG;
    const db = b - seedB;
    const colorDist = Math.sqrt(dr * dr + dg * dg + db * db);
    const lumaDist = Math.abs(luma - seedLuma);

    if (colorDist > COLOR_DIST_THRESHOLD || lumaDist > LUMA_DIST_THRESHOLD) continue;

    mask[idx] = 1;
    count++;

    if (x > 0)      enqueue(idx - 1);
    if (x < pw - 1) enqueue(idx + 1);
    if (y > 0)      enqueue(idx - pw);
    if (y < ph - 1) enqueue(idx + pw);
  }

  return { data: mask, width: pw, height: ph };
}
