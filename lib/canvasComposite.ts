/**
 * canvasComposite.ts
 *
 * MediaPipe confidence mask + 원본 이미지 → "배경 블러 + 피사체 선명" 합성
 *
 * 페더링 전략:
 *  1. Float32Array 마스크 → 그레이스케일 캔버스 변환
 *  2. 마스크에 blur 필터 → 경계 그라데이션(페더링)
 *  3. destination-in composite → 피사체 영역만 원본으로 클리핑
 *  4. 블러 배경 위에 클리핑된 피사체를 덮어 최종 합성
 */

export interface CompositeOptions {
  image: HTMLImageElement;
  maskData: Float32Array;
  maskWidth: number;
  maskHeight: number;
  blurRadius: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Float32Array 마스크를 원본 해상도의 그레이스케일 캔버스로 변환합니다.
 * 이 함수를 분리해 마스크 미리보기 기능에서도 재사용합니다.
 */
export function buildMaskCanvas(
  maskData: Float32Array,
  maskWidth: number,
  maskHeight: number,
  targetW: number,
  targetH: number
): HTMLCanvasElement {
  // 모델 해상도 캔버스에 Float32 → RGBA 변환
  const rawCanvas = makeCanvas(maskWidth, maskHeight);
  const rawCtx = rawCanvas.getContext("2d")!;
  const rawImageData = rawCtx.createImageData(maskWidth, maskHeight);

  for (let i = 0; i < maskData.length; i++) {
    const val = Math.round(maskData[i] * 255);
    const base = i * 4;
    rawImageData.data[base] = val;
    rawImageData.data[base + 1] = val;
    rawImageData.data[base + 2] = val;
    // destination-in은 source alpha를 기준으로 클리핑되므로
    // 알파 채널도 confidence 값과 같이 써야 배경이 실제로 투명해집니다.
    rawImageData.data[base + 3] = val;
  }
  rawCtx.putImageData(rawImageData, 0, 0);

  // 원본 해상도로 업스케일
  const scaledCanvas = makeCanvas(targetW, targetH);
  const scaledCtx = scaledCanvas.getContext("2d")!;
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = "high";
  scaledCtx.drawImage(rawCanvas, 0, 0, targetW, targetH);

  return scaledCanvas;
}

/**
 * 메인 합성 함수: 배경 블러 + 피사체 선명 결과를 outCanvas에 그립니다.
 */
export function compositeBlur(
  outCanvas: HTMLCanvasElement,
  options: CompositeOptions
): void {
  const { image, maskData, maskWidth, maskHeight, blurRadius } = options;

  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const longEdge = Math.max(W, H);

  // Slider value(0~30)를 원본 해상도에 맞는 실제 px 값으로 변환합니다.
  // 긴 변의 최대 1.2% 정도로 제한해 DSLR식 심도 느낌에 가깝게 조절합니다.
  const actualBlur = (blurRadius / 30) * (longEdge * 0.012);
  const actualFeather = Math.max(2, longEdge * 0.0035);

  outCanvas.width = W;
  outCanvas.height = H;
  const ctx = outCanvas.getContext("2d")!;

  // Step 1: 마스크 캔버스 생성 (원본 해상도)
  const maskCanvas = buildMaskCanvas(maskData, maskWidth, maskHeight, W, H);

  // Step 2: 마스크 페더링 — blur 필터로 경계를 흐리게
  const featheredCanvas = makeCanvas(W, H);
  const featheredCtx = featheredCanvas.getContext("2d")!;
  featheredCtx.filter = `blur(${actualFeather}px)`;
  featheredCtx.drawImage(maskCanvas, 0, 0);
  featheredCtx.filter = "none";

  // Step 3: 배경 블러 레이어
  const bgCanvas = makeCanvas(W, H);
  const bgCtx = bgCanvas.getContext("2d")!;
  // 가장자리 번짐 방지: 원본을 먼저 깔고 블러 레이어를 위에 올림
  bgCtx.drawImage(image, 0, 0, W, H);
  if (actualBlur > 0) {
    // 고해상도 캔버스에 blur(100px+)를 직접 걸면 브라우저가 멈추거나 무시할 수 있습니다.
    // 원본의 10% 크기에서 블러한 뒤 업스케일하면 연산량이 크게 줄고 체감 블러도 강해집니다.
    // 패딩을 둔 뒤 중앙 영역만 잘라와서 blur filter의 edge bleeding을 막습니다.
    const scale = 0.1;
    const scaledW = Math.max(1, Math.round(W * scale));
    const scaledH = Math.max(1, Math.round(H * scale));
    const scaledBlur = Math.max(0.5, actualBlur * scale);
    const padding = Math.ceil(scaledBlur * 3);
    const paddedW = scaledW + padding * 2;
    const paddedH = scaledH + padding * 2;
    const smallSourceCanvas = makeCanvas(paddedW, paddedH);
    const smallSourceCtx = smallSourceCanvas.getContext("2d")!;
    const blurredCanvas = makeCanvas(paddedW, paddedH);
    const blurredCtx = blurredCanvas.getContext("2d")!;

    smallSourceCtx.imageSmoothingEnabled = true;
    smallSourceCtx.imageSmoothingQuality = "high";
    smallSourceCtx.drawImage(image, padding, padding, scaledW, scaledH);

    // 사방 패딩 영역을 가장자리 픽셀로 채워 blur가 투명 배경으로 번지지 않게 합니다.
    smallSourceCtx.drawImage(image, 0, 0, 1, H, 0, padding, padding, scaledH);
    smallSourceCtx.drawImage(
      image,
      W - 1,
      0,
      1,
      H,
      padding + scaledW,
      padding,
      padding,
      scaledH
    );
    smallSourceCtx.drawImage(image, 0, 0, W, 1, padding, 0, scaledW, padding);
    smallSourceCtx.drawImage(
      image,
      0,
      H - 1,
      W,
      1,
      padding,
      padding + scaledH,
      scaledW,
      padding
    );

    blurredCtx.filter = `blur(${scaledBlur}px)`;
    blurredCtx.drawImage(smallSourceCanvas, 0, 0);
    blurredCtx.filter = "none";

    bgCtx.imageSmoothingEnabled = true;
    bgCtx.imageSmoothingQuality = "high";
    bgCtx.drawImage(blurredCanvas, padding, padding, scaledW, scaledH, 0, 0, W, H);
  }

  // Step 4: 피사체 클리핑 — destination-in으로 마스크 밝은 영역만 남김
  const subjectCanvas = makeCanvas(W, H);
  const subjectCtx = subjectCanvas.getContext("2d")!;
  subjectCtx.drawImage(image, 0, 0, W, H);
  subjectCtx.globalCompositeOperation = "destination-in";
  subjectCtx.drawImage(featheredCanvas, 0, 0);
  subjectCtx.globalCompositeOperation = "source-over";

  // Step 5: 최종 합성 — 배경 위에 피사체 덮기
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bgCanvas, 0, 0);
  ctx.drawImage(subjectCanvas, 0, 0);
}

/**
 * 마스크 미리보기: 배경 영역을 반투명 빨간색으로 오버레이합니다.
 * "어디가 배경으로 인식됐는지" 확인용
 */
export function drawMaskOverlay(
  outCanvas: HTMLCanvasElement,
  image: HTMLImageElement,
  maskData: Float32Array,
  maskWidth: number,
  maskHeight: number
): void {
  const W = image.naturalWidth;
  const H = image.naturalHeight;

  outCanvas.width = W;
  outCanvas.height = H;
  const ctx = outCanvas.getContext("2d")!;

  // 원본 이미지 먼저 그리기
  ctx.drawImage(image, 0, 0, W, H);

  // 마스크 캔버스 생성
  const maskCanvas = buildMaskCanvas(maskData, maskWidth, maskHeight, W, H);
  const maskCtx = maskCanvas.getContext("2d")!;
  const maskImageData = maskCtx.getImageData(0, 0, W, H);

  // 배경(confidence 낮은 영역)에 빨간 오버레이 적용
  const overlayCanvas = makeCanvas(W, H);
  const overlayCtx = overlayCanvas.getContext("2d")!;
  const overlayData = overlayCtx.createImageData(W, H);

  for (let i = 0; i < W * H; i++) {
    const confidence = maskImageData.data[i * 4] / 255; // 0=배경, 1=피사체
    const base = i * 4;
    // 배경일수록 불투명한 빨간색 오버레이
    overlayData.data[base] = 220; // R
    overlayData.data[base + 1] = 38; // G
    overlayData.data[base + 2] = 38; // B
    overlayData.data[base + 3] = Math.round((1 - confidence) * 160); // 배경: 불투명, 피사체: 투명
  }
  overlayCtx.putImageData(overlayData, 0, 0);

  // 원본 위에 오버레이
  ctx.drawImage(overlayCanvas, 0, 0);
}

/**
 * 캔버스를 고화질 JPEG/PNG로 다운로드합니다.
 */
export function downloadCanvas(
  canvas: HTMLCanvasElement,
  filename = "bbn-result",
  format: "jpeg" | "png" = "jpeg",
  quality = 0.95
): void {
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = canvas.toDataURL(mimeType, quality);
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${filename}.${format}`;
  link.click();
}
