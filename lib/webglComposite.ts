import { downloadCanvas } from "./canvasComposite";

export { downloadCanvas };

export interface SubjectMask {
  data: Uint8Array;     // 1 = 피사체(블러 차단), 0 = 배경 (binary)
  softData: Uint8Array; // 0–255 soft edge (JBU 마스크 가이드용)
  width: number;
  height: number;
}

export interface CompositeOptions {
  image: HTMLImageElement;
  depthData: Uint8Array;
  depthWidth: number;
  depthHeight: number;
  blurRadius: number;
  bokehShape?: number;
  /** 초점 범위 [왼쪽%, 오른쪽%] 0~100. 왼쪽=가까움, 오른쪽=멀. 이 구간(깊이) 안은 선명 */
  focusRange?: [number, number];
  /** true: 초점 슬라이더 드래그 중 저해상도 블러(발열·렉 완화) */
  blurInteractive?: boolean;
  /** 탭 투 포커스로 선택된 피사체 마스크. 해당 영역은 깊이와 무관하게 선명 유지 */
  subjectMask?: SubjectMask | null;
}

const MAX_WEBGL_INPUT_EDGE = 1024;
/** 초점 조절 중 블러 패스 긴 변 상한 */
const INTERACTIVE_BLUR_MAX_EDGE = 1024;
const BLUR_SLIDER_MAX = 30;

/**
 * JBU 캐시: depthData 레퍼런스 + maskRef가 둘 다 일치할 때만 재사용.
 * maskRef가 바뀌면(새 탭) 재계산하여 Mask-Guided JBU 결과를 갱신한다.
 */
const jbuCache = new WeakMap<
  Uint8Array,
  { w: number; h: number; canvas: HTMLCanvasElement; maskRef: HTMLCanvasElement | null }
>();

/** 타일링 필름 그레인 (블러 레이어만, 풀 해상도 getImageData 없음) */
let grainTileCanvas: HTMLCanvasElement | null = null;

function getGrainTileCanvas(): HTMLCanvasElement {
  if (grainTileCanvas) return grainTileCanvas;
  const sz = 256;
  const c = makeCanvas(sz, sz);
  const g = c.getContext("2d")!;
  const img = g.createImageData(sz, sz);
  const d = img.data;
  for (let i = 0; i < sz * sz; i++) {
    const v = 85 + Math.floor(Math.random() * 171);
    const b = i * 4;
    d[b] = d[b + 1] = d[b + 2] = v;
    d[b + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTileCanvas = c;
  return c;
}

/** 블러 레이어에만 미세 그레인 (인터랙티브 모드에서는 생략) */
function applyFilmGrainToBlurLayer(
  blurCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  blurInteractive: boolean
): void {
  if (blurInteractive) return;
  const tile = getGrainTileCanvas();
  blurCtx.save();
  blurCtx.globalAlpha = 0.028;
  blurCtx.globalCompositeOperation = "overlay";
  const tw = tile.width;
  const th = tile.height;
  for (let y = 0; y < h; y += th) {
    for (let x = 0; x < w; x += tw) {
      blurCtx.drawImage(tile, x, y);
    }
  }
  blurCtx.restore();
}

/** UI: 왼쪽=가까움(깊이 큼), 오른쪽=멀(깊이 작음) → 셰이더용 [u.x=먼쪽, u.y=가까운쪽] */
function focusRangeUiToDepthBounds(ui: [number, number]): [number, number] {
  const [leftPct, rightPct] = ui;
  return [(100 - rightPct) / 100, (100 - leftPct) / 100];
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * WebGL 캔버스 내용을 2D 캔버스로 복사한다.
 * `loseContext()` 호출 후에는 WebGL 프레임버퍼가 무효화되므로, 반드시 그 전에 호출해야 한다.
 */
function snapshotWebGLCanvasTo2D(glCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const snap = makeCanvas(glCanvas.width, glCanvas.height);
  const c = snap.getContext("2d")!;
  c.drawImage(glCanvas, 0, 0);
  return snap;
}

function turboLikeColor(t: number): [number, number, number] {
  const stops: Array<[number, number, number, number]> = [
    [0.0, 48, 18, 59],
    [0.2, 50, 100, 190],
    [0.4, 40, 200, 220],
    [0.6, 100, 220, 80],
    [0.8, 245, 180, 40],
    [1.0, 230, 55, 35],
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const localT = (t - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1] + (b[1] - a[1]) * localT),
        Math.round(a[2] + (b[2] - a[2]) * localT),
        Math.round(a[3] + (b[3] - a[3]) * localT),
      ];
    }
  }

  return [230, 55, 35];
}

export type DrawMaskOverlayOptions = {
  /**
   * 픽셀 루프·getImageData를 이 긴 변 이하로 제한 (드래그 중 프리뷰용).
   * 미설정이면 원본 풀 해상도.
   */
  maxProcessingEdge?: number;
};

export function drawMaskOverlay(
  outCanvas: HTMLCanvasElement,
  image: HTMLImageElement,
  depthData: Uint8Array,
  depthWidth: number,
  depthHeight: number,
  focusRange: [number, number] = [0, 100],
  opts?: DrawMaskOverlayOptions
): void {
  try {
    renderDepthMapOverlayWebGL(
      outCanvas,
      image,
      depthData,
      depthWidth,
      depthHeight,
      focusRange
    );
  } catch (e) {
    console.warn("[drawMaskOverlay] WebGL overlay failed, CPU fallback", e);
    drawMaskOverlayCpu(
      outCanvas,
      image,
      depthData,
      depthWidth,
      depthHeight,
      focusRange,
      opts
    );
  }
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("WebGL shader creation failed");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "Unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(info);
  }

  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    throw new Error("WebGL program creation failed");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "Unknown program link error";
    gl.deleteProgram(program);
    throw new Error(info);
  }

  return program;
}

function createDownscaledCanvas(
  image: HTMLImageElement,
  maxInputEdge: number = MAX_WEBGL_INPUT_EDGE
): {
  canvas: HTMLCanvasElement;
  scale: number;
} {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const longEdge = Math.max(W, H);
  const scale = longEdge > maxInputEdge ? maxInputEdge / longEdge : 1;
  const scaledW = Math.max(1, Math.round(W * scale));
  const scaledH = Math.max(1, Math.round(H * scale));
  const canvas = makeCanvas(scaledW, scaledH);
  const ctx = canvas.getContext("2d")!;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, scaledW, scaledH);

  return { canvas, scale };
}

function createDepthTextureCanvas(
  depthData: Uint8Array,
  depthWidth: number,
  depthHeight: number
): HTMLCanvasElement {
  const canvas = makeCanvas(depthWidth, depthHeight);
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(depthWidth, depthHeight);

  for (let i = 0; i < depthWidth * depthHeight; i++) {
    const val = depthData[i] ?? 0;
    const base = i * 4;
    imageData.data[base] = val;
    imageData.data[base + 1] = val;
    imageData.data[base + 2] = val;
    imageData.data[base + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** 거리 맵 컬러 오버레이: GPU 풀스크린(슬라이더 실시간 60fps) */
function renderDepthMapOverlayWebGL(
  outCanvas: HTMLCanvasElement,
  image: HTMLImageElement,
  depthData: Uint8Array,
  depthWidth: number,
  depthHeight: number,
  focusRange: [number, number]
): void {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const glCanvas = makeCanvas(W, H);
  const gl = glCanvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    throw new Error("WebGL is not available");
  }

  const vertexSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const fragmentSource = `
    precision highp float;
    uniform sampler2D u_image;
    uniform sampler2D u_depthMap;
    uniform vec2 u_focusRange;
    varying vec2 v_texCoord;

    vec3 turboMap(float x) {
      x = clamp(x, 0.0, 1.0);
      vec3 c0 = vec3(0.188235, 0.070588, 0.231373);
      vec3 c1 = vec3(0.196078, 0.392157, 0.745098);
      vec3 c2 = vec3(0.156863, 0.784314, 0.862745);
      vec3 c3 = vec3(0.392157, 0.862745, 0.313725);
      vec3 c4 = vec3(0.960784, 0.705882, 0.156863);
      vec3 c5 = vec3(0.901961, 0.215686, 0.137255);
      float u = x * 5.0;
      if (u < 1.0) return mix(c0, c1, u);
      if (u < 2.0) return mix(c1, c2, u - 1.0);
      if (u < 3.0) return mix(c2, c3, u - 2.0);
      if (u < 4.0) return mix(c3, c4, u - 3.0);
      return mix(c4, c5, u - 4.0);
    }

    void main() {
      float depth = texture2D(u_depthMap, v_texCoord).r;
      vec3 turbo = turboMap(depth);
      vec3 base = texture2D(u_image, v_texCoord).rgb;
      bool inFocus = depth >= u_focusRange.x && depth <= u_focusRange.y;
      float overlayAlpha = inFocus ? 0.784314 : 0.215686;
      vec3 outRgb = mix(base, turbo, overlayAlpha);
      gl_FragColor = vec4(outRgb, 1.0);
    }
  `;

  const program = createProgram(gl, vertexSource, fragmentSource);
  gl.useProgram(program);
  gl.viewport(0, 0, W, H);

  const vertices = new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1,
  ]);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");

  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(texCoordLocation);
  gl.vertexAttribPointer(
    texCoordLocation,
    2,
    gl.FLOAT,
    false,
    stride,
    2 * Float32Array.BYTES_PER_ELEMENT
  );

  const imageTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, imageTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

  const depthCanvas = createDepthTextureCanvas(depthData, depthWidth, depthHeight);
  const depthTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, depthCanvas);

  const imageLoc = gl.getUniformLocation(program, "u_image");
  const depthLoc = gl.getUniformLocation(program, "u_depthMap");
  const focusLoc = gl.getUniformLocation(program, "u_focusRange");
  const [dFar, dNear] = focusRangeUiToDepthBounds(focusRange);

  gl.uniform1i(imageLoc, 0);
  gl.uniform1i(depthLoc, 1);
  gl.uniform2f(focusLoc, dFar, dNear);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  outCanvas.width = W;
  outCanvas.height = H;
  const outCtx = outCanvas.getContext("2d")!;
  // loseContext 전에 픽셀을 복사해야 함 (그렇지 않으면 버퍼가 비어 보임)
  outCtx.drawImage(glCanvas, 0, 0);

  if (imageTex) gl.deleteTexture(imageTex);
  if (depthTex) gl.deleteTexture(depthTex);
  if (buffer) gl.deleteBuffer(buffer);
  gl.deleteProgram(program);
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}

function drawMaskOverlayCpu(
  outCanvas: HTMLCanvasElement,
  image: HTMLImageElement,
  depthData: Uint8Array,
  depthWidth: number,
  depthHeight: number,
  focusRange: [number, number],
  opts?: DrawMaskOverlayOptions
): void {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  outCanvas.width = W;
  outCanvas.height = H;

  const ctx = outCanvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0, W, H);

  const longEdge = Math.max(W, H);
  const cap = opts?.maxProcessingEdge;
  const scale = cap != null && longEdge > cap ? cap / longEdge : 1;
  const pw = Math.max(1, Math.round(W * scale));
  const ph = Math.max(1, Math.round(H * scale));

  const depthCanvas = createDepthTextureCanvas(depthData, depthWidth, depthHeight);
  const scaledDepthCanvas = makeCanvas(pw, ph);
  const scaledDepthCtx = scaledDepthCanvas.getContext("2d")!;
  scaledDepthCtx.imageSmoothingEnabled = true;
  scaledDepthCtx.imageSmoothingQuality = "high";
  scaledDepthCtx.drawImage(depthCanvas, 0, 0, pw, ph);

  const depthPixels = scaledDepthCtx.getImageData(0, 0, pw, ph);
  const overlay = scaledDepthCtx.createImageData(pw, ph);

  const [dFar, dNear] = focusRangeUiToDepthBounds(focusRange);
  const pixelCount = pw * ph;

  for (let i = 0; i < pixelCount; i++) {
    const depth = depthPixels.data[i * 4] / 255;
    const [r, g, b] = turboLikeColor(depth);
    const base = i * 4;
    const inFocus = depth >= dFar && depth <= dNear;
    overlay.data[base] = r;
    overlay.data[base + 1] = g;
    overlay.data[base + 2] = b;
    overlay.data[base + 3] = inFocus ? 200 : 55;
  }

  const overlayCanvas = makeCanvas(pw, ph);
  overlayCanvas.getContext("2d")!.putImageData(overlay, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(overlayCanvas, 0, 0, pw, ph, 0, 0, W, H);
}

/**
 * Mask-Guided Joint Bilateral Upsampling (JBU) — 1-pass WebGL
 *
 * 저해상도 깊이 맵을 고해상도 컬러 이미지(guide)의 엣지에 맞춰 업샘플.
 * 5×5 커널: 공간 가우시안 × 컬러 유사도 가우시안 × 마스크 경계 가중치.
 * maskCanvas가 제공되면 전경/배경 depth 값이 경계를 넘어 누출되는 현상을 방지한다.
 * (논문 Fig. 2(e) layered compositing을 WebGL 단패스로 근사)
 *
 * @param rawDepthCanvas  AI 모델 원본 저해상도 깊이 캔버스
 * @param guideCanvas     업샘플 목표 해상도의 컬러 이미지 캔버스
 * @param maskCanvas      SubjectMask softData 기반 그레이스케일 캔버스 (없으면 마스크 가중치 = 1)
 * @returns               guideCanvas 해상도와 동일한 엣지 보존 깊이 캔버스
 */
function upsampleDepthJBU(
  rawDepthCanvas: HTMLCanvasElement,
  guideCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement | null
): HTMLCanvasElement {
  const W = guideCanvas.width;
  const H = guideCanvas.height;

  const glCanvas = makeCanvas(W, H);
  const gl = glCanvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    // WebGL 없으면 단순 쌍선형 폴백
    const fb = makeCanvas(W, H);
    const fc = fb.getContext("2d")!;
    fc.imageSmoothingEnabled = true;
    fc.imageSmoothingQuality = "high";
    fc.drawImage(rawDepthCanvas, 0, 0, W, H);
    return fb;
  }

  const vertSrc = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  // 5×5 Mask-Guided Joint Bilateral:
  //   공간 가우시안(σ=1.6) × 컬러 가우시안(σ²≈0.04) × 마스크 경계 가우시안(σ²≈0.005)
  // maskW: 마스크 값 차이가 0.07(≈18/255) 이상이면 가중치가 급격히 감소 →
  //   전경 픽셀이 배경 depth 값을 흡수하지 못함 = 경계 누출(halo) 방지
  const fragSrc = `
    precision highp float;

    uniform sampler2D u_depth;
    uniform sampler2D u_guide;
    uniform sampler2D u_mask;
    uniform vec2 u_depthSize;

    varying vec2 v_texCoord;

    void main() {
      vec3  guideCenter = texture2D(u_guide, v_texCoord).rgb;
      float maskCenter  = texture2D(u_mask,  v_texCoord).r;

      float sumDepth  = 0.0;
      float sumWeight = 0.0;

      for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
          vec2 offset  = vec2(float(dx), float(dy)) / u_depthSize;
          vec2 sampleUV = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));

          float d = texture2D(u_depth, sampleUV).r;
          vec3  g = texture2D(u_guide, sampleUV).rgb;
          float m = texture2D(u_mask,  sampleUV).r;

          // 공간 가우시안 (σ=1.6 → 2σ²≈5.12)
          float spatialW = exp(-float(dx*dx + dy*dy) / 5.12);

          // 컬러 가우시안 (σ²≈0.04)
          vec3  cd = guideCenter - g;
          float colorW = exp(-dot(cd, cd) / 0.04);

          // 마스크 경계 가우시안 (σ²≈0.005)
          // 마스크 값 차이가 클수록 cross-boundary 샘플 가중치 급감 → layered 분리 효과
          float maskDiff = abs(maskCenter - m);
          float maskW = exp(-maskDiff * maskDiff / 0.005);

          float w = spatialW * colorW * maskW;
          sumDepth  += d * w;
          sumWeight += w;
        }
      }

      float outDepth = sumDepth / max(sumWeight, 1e-5);
      gl_FragColor = vec4(outDepth, outDepth, outDepth, 1.0);
    }
  `;

  const program = createProgram(gl, vertSrc, fragSrc);
  gl.useProgram(program);
  gl.viewport(0, 0, W, H);

  const verts = new Float32Array([
    -1, -1, 0, 0,  1, -1, 1, 0,  -1, 1, 0, 1,
    -1,  1, 0, 1,  1, -1, 1, 0,   1, 1, 1, 1,
  ]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const posLoc = gl.getAttribLocation(program, "a_position");
  const uvLoc  = gl.getAttribLocation(program, "a_texCoord");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

  const depthTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // 깊이 맵은 커널 샘플링 시 선형 보간 사용 (커널 밖 경계값 스무딩)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, rawDepthCanvas);

  const guideTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, guideTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, guideCanvas);

  // TEXTURE2: 마스크 텍스처. 없으면 전체 흰색 1×1 텍스처(maskW = 1.0 → 기존 동작 유지)
  const maskTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (maskCanvas) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
  } else {
    // 단색 흰색 1×1: maskCenter=1, maskSample=1 → maskDiff=0 → maskW=1.0
    const white = new Uint8Array([255, 255, 255, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, white);
  }

  gl.uniform1i(gl.getUniformLocation(program, "u_depth"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_guide"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "u_mask"),  2);
  gl.uniform2f(
    gl.getUniformLocation(program, "u_depthSize"),
    rawDepthCanvas.width,
    rawDepthCanvas.height
  );

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  const snapshot = snapshotWebGLCanvasTo2D(glCanvas);

  if (depthTex)  gl.deleteTexture(depthTex);
  if (guideTex)  gl.deleteTexture(guideTex);
  if (maskTex)   gl.deleteTexture(maskTex);
  if (buf) gl.deleteBuffer(buf);
  gl.deleteProgram(program);
  gl.getExtension("WEBGL_lose_context")?.loseContext();

  return snapshot;
}

function getOrComputeJBU(
  depthData: Uint8Array,
  depthWidth: number,
  depthHeight: number,
  targetW: number,
  targetH: number,
  maskCanvas: HTMLCanvasElement | null
): HTMLCanvasElement {
  const cached = jbuCache.get(depthData);
  if (
    cached &&
    cached.w === targetW &&
    cached.h === targetH &&
    cached.maskRef === maskCanvas
  ) {
    return cached.canvas;
  }

  const rawDepthCanvas = createDepthTextureCanvas(depthData, depthWidth, depthHeight);
  const targetCanvas = makeCanvas(targetW, targetH);
  let highRes: HTMLCanvasElement;
  try {
    highRes = upsampleDepthJBU(rawDepthCanvas, targetCanvas, maskCanvas);
  } catch (e) {
    console.warn("[JBU] failed, bilinear fallback", e);
    highRes = makeCanvas(targetW, targetH);
    const fc = highRes.getContext("2d")!;
    fc.imageSmoothingEnabled = true;
    fc.imageSmoothingQuality = "high";
    fc.drawImage(rawDepthCanvas, 0, 0, targetW, targetH);
  }

  jbuCache.set(depthData, { w: targetW, h: targetH, canvas: highRes, maskRef: maskCanvas });
  return highRes;
}

function renderBlurAlphaMaskWebGL(
  depthCanvas: HTMLCanvasElement,
  focusRange: [number, number]
): HTMLCanvasElement {
  const W = depthCanvas.width;
  const H = depthCanvas.height;
  const glCanvas = makeCanvas(W, H);
  const gl = glCanvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    const fallback = makeCanvas(W, H);
    const fallbackCtx = fallback.getContext("2d")!;
    const depthCtx = depthCanvas.getContext("2d")!;
    const depthPixels = depthCtx.getImageData(0, 0, W, H);
    const mask = fallbackCtx.createImageData(W, H);
    const [dFar, dNear] = focusRangeUiToDepthBounds(focusRange);
    const edgeZone = 0.04;

    for (let i = 0; i < W * H; i++) {
      const depth = depthPixels.data[i * 4] / 255;
      const base = i * 4;
      // 초점 경계에서 부드럽게 전이 (hard step → soft ramp)
      const distToFocus = Math.max(dFar - depth, depth - dNear, 0);
      const alpha = Math.min(1, distToFocus / edgeZone);
      mask.data[base] = 255;
      mask.data[base + 1] = 255;
      mask.data[base + 2] = 255;
      mask.data[base + 3] = Math.round(alpha * 255);
    }

    // 마스크 윤곽선을 살짝 뭉개서 합성 경계를 부드럽게
    const tempCanvas = makeCanvas(W, H);
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.putImageData(mask, 0, 0);
    fallbackCtx.filter = "blur(3px)";
    fallbackCtx.drawImage(tempCanvas, 0, 0);
    fallbackCtx.filter = "none";
    return fallback;
  }

  const vertexSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const fragmentSource = `
    precision highp float;

    uniform sampler2D u_depthMap;
    uniform vec2 u_focusRange;

    varying vec2 v_texCoord;

    void main() {
      float depth = texture2D(u_depthMap, v_texCoord).r;

      // 초점 경계까지의 거리 계산 → 경계 전이 구간(edgeZone)에서 smoothstep으로 부드럽게 전이
      float edgeZone = 0.04;
      float distToFocus = max(u_focusRange.x - depth, depth - u_focusRange.y);
      distToFocus = max(distToFocus, 0.0);

      // smoothstep: 0=완전 초점 → 1=완전 블러, 경계에서 S커브 전이
      float alpha = smoothstep(0.0, edgeZone, distToFocus);

      gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
    }
  `;

  const program = createProgram(gl, vertexSource, fragmentSource);
  gl.useProgram(program);
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const vertices = new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1,
    -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1,
  ]);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");

  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(texCoordLocation);
  gl.vertexAttribPointer(
    texCoordLocation,
    2,
    gl.FLOAT,
    false,
    stride,
    2 * Float32Array.BYTES_PER_ELEMENT
  );

  const depthTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, depthTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, depthCanvas);

  const depthLocation = gl.getUniformLocation(program, "u_depthMap");
  const focusRangeLocation = gl.getUniformLocation(program, "u_focusRange");
  const [dFar, dNear] = focusRangeUiToDepthBounds(focusRange);

  gl.uniform1i(depthLocation, 0);
  gl.uniform2f(focusRangeLocation, dFar, dNear);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  const snapshot = snapshotWebGLCanvasTo2D(glCanvas);

  if (depthTexture) gl.deleteTexture(depthTexture);
  if (buffer) gl.deleteBuffer(buffer);
  gl.deleteProgram(program);
  gl.getExtension("WEBGL_lose_context")?.loseContext();

  return snapshot;
}

function renderLensBlurWebGL(
  sourceCanvas: HTMLCanvasElement,
  blurRadius: number,
  depthData: Uint8Array,
  depthWidth: number,
  depthHeight: number,
  bokehShape: number,
  focusRange: [number, number],
  maskCanvas: HTMLCanvasElement | null
): HTMLCanvasElement {
  const glCanvas = makeCanvas(sourceCanvas.width, sourceCanvas.height);
  const gl = glCanvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    throw new Error("WebGL is not available");
  }

  const vertexSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const fragmentSource = `
    precision highp float;

    const int SAMPLES = 64;
    const float GOLDEN_ANGLE = 2.39996323;
    const float PI = 3.14159265359;
    const float GAMMA = 2.2;
    // MDE 0–1 정규 깊이: 물리 미터 복원 전 단계. invZ만 쓰면 규약 변경이 한곳에 모임.
    const float DEPTH_EPS = 0.001;
    const float COC_SCALE = 0.18;
    const float GATHER_SOFT_PX = 3.0;
    // On-focal occlusion (Dr. Bokeh 근사): 초점 밖 픽셀은 카메라 쪽(깊이 큼) 샘플이 가리면 수집 거절
    const float ONFOCAL_OCCLUDE_EPS = 0.03;

    uniform sampler2D u_image;
    uniform sampler2D u_depthMap;
    uniform vec2 u_resolution;
    uniform float u_blurRadius;
    uniform float u_threshold;
    uniform vec2 u_focusRange;
    uniform int u_shape;

    varying vec2 v_texCoord;

    float invZ(float d) {
      return 1.0 / (d + DEPTH_EPS);
    }

    float sdHexagon(vec2 p) {
      p = abs(p);
      return max(dot(p, normalize(vec2(1.7320508, 1.0))), p.y) - 1.0;
    }

    float sdHeart(vec2 p) {
      p.y -= 0.15;
      p *= 1.25;
      float a = p.x * p.x + p.y * p.y - 0.65;
      return a * a * a - p.x * p.x * p.y * p.y * p.y;
    }

    float sdStar(vec2 p) {
      float r = length(p);
      float a = atan(p.y, p.x);
      float n = 5.0;
      float sector = PI / n;
      float k = cos(floor(0.5 + a / sector) * sector - a);
      float boundary = mix(0.45, 1.0, smoothstep(0.15, 1.0, k));
      return r - boundary;
    }

    bool insideBokehShape(vec2 p, int shape) {
      if (shape == 1) { return sdHexagon(p) <= 0.0; }
      if (shape == 2) { return sdHeart(p)   <= 0.0; }
      if (shape == 3) { return sdStar(p)    <= 0.0; }
      return length(p) <= 1.0;
    }

    bool inFocusDepth(float depth) {
      return depth >= u_focusRange.x && depth <= u_focusRange.y;
    }

    vec3 toLinear(vec3 srgb) {
      return pow(max(srgb, vec3(1e-6)), vec3(GAMMA));
    }

    vec3 toSrgb(vec3 lin) {
      return pow(max(lin, vec3(1e-6)), vec3(1.0 / GAMMA));
    }

    void main() {
      // 하이라이트는 가중치만 키움(색상 곱 부스트 없음 → 에너지 보존에 유리)
      const float BOKEH_INTENSITY = 8.0;

      float centerDepth = texture2D(u_depthMap, v_texCoord).r;
      vec3  centerSrgb  = texture2D(u_image,    v_texCoord).rgb;
      vec3  centerColor = toLinear(centerSrgb);
      float centerLuma  = dot(centerColor, vec3(0.299, 0.587, 0.114));

      // 초점 대역 끝의 역깊이 중점 = 초점 평면(옵션 A, 셰이더만)
      float invFocal = 0.5 * (invZ(u_focusRange.x) + invZ(u_focusRange.y));
      float centerCoC = abs(invZ(centerDepth) - invFocal);
      float depthWeight = clamp(centerCoC * COC_SCALE, 0.0, 1.0);

      bool centerInFocus = inFocusDepth(centerDepth);
      if (!centerInFocus) {
        vec2 texel = 1.0 / u_resolution;
        bool neighborInFocus =
          inFocusDepth(texture2D(u_depthMap, clamp(v_texCoord + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).r) ||
          inFocusDepth(texture2D(u_depthMap, clamp(v_texCoord - vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).r) ||
          inFocusDepth(texture2D(u_depthMap, clamp(v_texCoord + vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).r) ||
          inFocusDepth(texture2D(u_depthMap, clamp(v_texCoord - vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).r);
        if (neighborInFocus) {
          depthWeight *= 0.5;
        }
      }
      float effectiveBlur = u_blurRadius * depthWeight;

      // Cat's eye: 종횡비 보정 NDC, 코너까지 정규화해 squash 계수가 음수로 가지 않게 clamp
      float asp = u_resolution.x / max(u_resolution.y, 1.0);
      vec2  ndc = vec2((v_texCoord.x - 0.5) * asp, v_texCoord.y - 0.5);
      float distFromCenter = length(ndc);
      float rmax = 0.5 * sqrt(asp * asp + 1.0);
      float distNorm = clamp(distFromCenter / max(rmax, 1e-4), 0.0, 1.0);
      vec2  dirToCenter = distFromCenter > 0.001 ? ndc / distFromCenter : vec2(1.0, 0.0);

      vec3  color       = vec3(0.0);
      float totalWeight = 0.0;
      float caOffset = effectiveBlur * 0.0008;
      float threshLin = pow(max(u_threshold, 1e-4), GAMMA);

      for (int i = 0; i < SAMPLES; i++) {
        float r     = sqrt(float(i) + 0.5) / sqrt(float(SAMPLES));
        float theta = float(i) * GOLDEN_ANGLE;
        vec2  shapePoint = vec2(cos(theta), sin(theta)) * r;

        float squash = mix(1.0, 0.55, distNorm * 0.95);
        float proj = dot(shapePoint, dirToCenter);
        vec2  perp = shapePoint - dirToCenter * proj;
        shapePoint = dirToCenter * proj + perp * squash;

        if (!insideBokehShape(shapePoint, u_shape)) { continue; }

        vec2 offset = shapePoint * (effectiveBlur / u_resolution);
        vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
        vec2 offsetPx = offset * u_resolution;
        float distPx = length(offsetPx);

        vec2 caDir = normalize(offset + vec2(1e-6)) * caOffset;
        vec3 sR = texture2D(u_image, clamp(sampleCoord + caDir, vec2(0.0), vec2(1.0))).rgb;
        vec3 sG = texture2D(u_image, sampleCoord).rgb;
        vec3 sB = texture2D(u_image, clamp(sampleCoord - caDir, vec2(0.0), vec2(1.0))).rgb;
        vec3 sampleColor = toLinear(vec3(sR.r, sG.g, sB.b));
        float sampleDepth = texture2D(u_depthMap, sampleCoord).r;
        float sampleCoC = abs(invZ(sampleDepth) - invFocal);
        float sampleDiskPx = max(0.75, clamp(sampleCoC * COC_SCALE, 0.0, 1.0) * u_blurRadius);
        float gatherW = 1.0 - smoothstep(sampleDiskPx, sampleDiskPx + GATHER_SOFT_PX, distPx);

        float sampleLuma = dot(sampleColor, vec3(0.299, 0.587, 0.114));
        float lumaDiff   = abs(sampleLuma - centerLuma);

        float dd = sampleDepth - centerDepth;
        float edgeDepthW = 1.0;
        if (centerInFocus) {
          if (dd < 0.0) {
            edgeDepthW = exp(-(dd * dd) * 25.0);
          } else {
            edgeDepthW = exp(-(dd * dd) * 8.0);
          }
        } else {
          if (dd > 0.0) {
            edgeDepthW = exp(-(dd * dd) * 5.0);
          } else {
            edgeDepthW = exp(-(dd * dd) * 18.0);
          }
        }

        float edgeWeight = edgeDepthW * exp(-(lumaDiff * lumaDiff) * 5.0);
        float bokehWeight = 1.0;
        if (sampleLuma > threshLin) {
          float hiL = sampleLuma - threshLin;
          bokehWeight += hiL * hiL * BOKEH_INTENSITY;
        }
        float onFocalOcc = 1.0;
        if (!centerInFocus) {
          if (sampleDepth > centerDepth + ONFOCAL_OCCLUDE_EPS) {
            onFocalOcc = 0.0;
          }
        }
        float rim = smoothstep(0.52, 0.94, length(shapePoint));
        float shapeWeight = mix(0.7, 1.3, rim);
        float weight = bokehWeight * edgeWeight * gatherW * onFocalOcc * shapeWeight;

        color       += sampleColor * weight;
        totalWeight += weight;
      }

      if (totalWeight <= 0.0) {
        gl_FragColor = vec4(centerSrgb, 1.0);
        return;
      }

      vec3 blurredLinear = color / totalWeight;
      float blurMix = smoothstep(0.35, 10.0, totalWeight);
      vec3 mixedLinear = mix(centerColor, blurredLinear, blurMix);
      gl_FragColor = vec4(toSrgb(mixedLinear), 1.0);
    }
  `;

  const program = createProgram(gl, vertexSource, fragmentSource);
  gl.useProgram(program);
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);

  const vertices = new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1,
  ]);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");

  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(texCoordLocation);
  gl.vertexAttribPointer(
    texCoordLocation,
    2,
    gl.FLOAT,
    false,
    stride,
    2 * Float32Array.BYTES_PER_ELEMENT
  );

  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

  // Mask-Guided JBU: 저해상도 깊이 맵을 guide 이미지 해상도로 엣지 보존 업샘플 (캐시 활용)
  const depthCanvas = getOrComputeJBU(depthData, depthWidth, depthHeight, sourceCanvas.width, sourceCanvas.height, maskCanvas);
  const depthTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, depthTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, depthCanvas);

  const imageLocation = gl.getUniformLocation(program, "u_image");
  const depthLocation = gl.getUniformLocation(program, "u_depthMap");
  const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
  const blurRadiusLocation = gl.getUniformLocation(program, "u_blurRadius");
  const thresholdLocation = gl.getUniformLocation(program, "u_threshold");
  const focusRangeLocation = gl.getUniformLocation(program, "u_focusRange");
  const shapeLocation = gl.getUniformLocation(program, "u_shape");

  gl.uniform1i(imageLocation, 0);
  gl.uniform1i(depthLocation, 1);
  gl.uniform2f(resolutionLocation, sourceCanvas.width, sourceCanvas.height);
  gl.uniform1f(blurRadiusLocation, blurRadius);
  gl.uniform1f(thresholdLocation, 0.6);
  const [dFar, dNear] = focusRangeUiToDepthBounds(focusRange);
  gl.uniform2f(focusRangeLocation, dFar, dNear);
  gl.uniform1i(shapeLocation, bokehShape);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  const snapshot = snapshotWebGLCanvasTo2D(glCanvas);

  if (texture) gl.deleteTexture(texture);
  if (depthTexture) gl.deleteTexture(depthTexture);
  if (buffer) gl.deleteBuffer(buffer);
  gl.deleteProgram(program);
  gl.getExtension("WEBGL_lose_context")?.loseContext();

  return snapshot;
}

export function compositeBlur(
  outCanvas: HTMLCanvasElement,
  options: CompositeOptions
): void {
  const {
    image,
    depthData,
    depthWidth,
    depthHeight,
    blurRadius,
    bokehShape = 0,
    focusRange = [0, 100],
    blurInteractive = false,
    subjectMask = null,
  } = options;

  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const longEdge = Math.max(W, H);
  const actualBlur = (blurRadius / BLUR_SLIDER_MAX) * (longEdge * 0.012);

  outCanvas.width = W;
  outCanvas.height = H;
  const ctx = outCanvas.getContext("2d")!;

  const maxEdge = blurInteractive ? INTERACTIVE_BLUR_MAX_EDGE : MAX_WEBGL_INPUT_EDGE;
  const { canvas: downscaledCanvas, scale } = createDownscaledCanvas(image, maxEdge);
  const scaledBlurRadius = actualBlur * scale;

  ctx.clearRect(0, 0, W, H);
  // Base layer: 초점 영역은 어떤 다운스케일/셰이더도 거치지 않은 원본을 유지한다.
  ctx.drawImage(image, 0, 0, W, H);

  if (scaledBlurRadius <= 0) {
    return;
  }

  // Mask-Guided JBU용 마스크 캔버스: subjectMask가 있으면 softData로 생성
  const jbuMaskCanvas = subjectMask
    ? buildMaskTextureCanvas(subjectMask, downscaledCanvas.width, downscaledCanvas.height)
    : null;

  const lensBlurCanvas = renderLensBlurWebGL(
    downscaledCanvas,
    scaledBlurRadius,
    depthData,
    depthWidth,
    depthHeight,
    bokehShape,
    focusRange,
    jbuMaskCanvas
  );

  const blurLayer = makeCanvas(W, H);
  const blurCtx = blurLayer.getContext("2d")!;
  blurCtx.imageSmoothingEnabled = true;
  blurCtx.imageSmoothingQuality = "high";
  blurCtx.drawImage(lensBlurCanvas, 0, 0, W, H);
  applyFilmGrainToBlurLayer(blurCtx, W, H, blurInteractive);

  // Mask-Guided JBU 고해상도 뎁스 맵 (캐시 활용: depthData + maskRef 동일 시 재사용)
  const jbuMaskCanvasHR = subjectMask
    ? buildMaskTextureCanvas(subjectMask, W, H)
    : null;
  const highResDepthCanvas = getOrComputeJBU(depthData, depthWidth, depthHeight, W, H, jbuMaskCanvasHR);

  const blurMask = renderBlurAlphaMaskWebGL(highResDepthCanvas, focusRange);
  blurCtx.globalCompositeOperation = "destination-in";
  blurCtx.drawImage(blurMask, 0, 0, W, H);
  blurCtx.globalCompositeOperation = "source-over";

  // Subject Lock: 탭으로 선택된 피사체 영역을 블러 레이어에서 제거 → 원본 4K 그대로 드러남
  if (subjectMask) {
    const subjectLockCanvas = buildSubjectLockCanvas(subjectMask, W, H);
    blurCtx.globalCompositeOperation = "destination-out";
    blurCtx.drawImage(subjectLockCanvas, 0, 0, W, H);
    blurCtx.globalCompositeOperation = "source-over";
  }

  ctx.drawImage(blurLayer, 0, 0);
}

/**
 * SubjectMask.softData(0–255)를 그레이스케일 캔버스로 변환한다.
 * CSS blur 없이 순수 픽셀값을 사용 — BFS box blur로 이미 부드럽게 처리됨.
 * JBU 셰이더의 u_mask(TEXTURE2)로 전달되어 경계 분리 가중치를 제공한다.
 */
function buildMaskTextureCanvas(
  mask: SubjectMask,
  targetW: number,
  targetH: number
): HTMLCanvasElement {
  const raw = makeCanvas(mask.width, mask.height);
  const rawCtx = raw.getContext("2d")!;
  const imageData = rawCtx.createImageData(mask.width, mask.height);

  for (let i = 0; i < mask.width * mask.height; i++) {
    const val = mask.softData[i] ?? 0;
    const base = i * 4;
    imageData.data[base] = val;
    imageData.data[base + 1] = val;
    imageData.data[base + 2] = val;
    imageData.data[base + 3] = 255;
  }
  rawCtx.putImageData(imageData, 0, 0);

  const scaled = makeCanvas(targetW, targetH);
  const scaledCtx = scaled.getContext("2d")!;
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = "high";
  scaledCtx.drawImage(raw, 0, 0, targetW, targetH);
  return scaled;
}

function buildSubjectLockCanvas(
  mask: SubjectMask,
  targetW: number,
  targetH: number
): HTMLCanvasElement {
  const raw = makeCanvas(mask.width, mask.height);
  const rawCtx = raw.getContext("2d")!;
  const imageData = rawCtx.createImageData(mask.width, mask.height);

  for (let i = 0; i < mask.width * mask.height; i++) {
    const base = i * 4;
    const inSubject = mask.data[i] === 1;
    imageData.data[base] = 255;
    imageData.data[base + 1] = 255;
    imageData.data[base + 2] = 255;
    imageData.data[base + 3] = inSubject ? 255 : 0;
  }
  rawCtx.putImageData(imageData, 0, 0);

  const scaled = makeCanvas(targetW, targetH);
  const scaledCtx = scaled.getContext("2d")!;
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = "high";
  // 외곽선을 픽셀 단위로 딱 자르지 않고 배경과 부드럽게 섞이도록 페더링
  scaledCtx.filter = "blur(2px)";
  scaledCtx.drawImage(raw, 0, 0, targetW, targetH);
  scaledCtx.filter = "none";
  return scaled;
}
