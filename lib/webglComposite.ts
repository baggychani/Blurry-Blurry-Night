import { downloadCanvas } from "./canvasComposite";

export { downloadCanvas };

export interface SubjectMask {
  data: Uint8Array; // 1 = 피사체(블러 차단), 0 = 배경
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

  if (imageTex) gl.deleteTexture(imageTex);
  if (depthTex) gl.deleteTexture(depthTex);
  if (buffer) gl.deleteBuffer(buffer);
  gl.deleteProgram(program);

  outCanvas.width = W;
  outCanvas.height = H;
  const outCtx = outCanvas.getContext("2d")!;
  outCtx.drawImage(glCanvas, 0, 0);
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
 * Joint Bilateral Upsampling (JBU) — 1-pass WebGL
 *
 * 저해상도 깊이 맵을 고해상도 컬러 이미지(guide)의 엣지에 맞춰 업샘플.
 * 5×5 커널: 공간 가우시안 × 컬러 유사도 가우시안 → 피사체 경계에서 깊이가
 * 원본 이미지 윤곽선을 따라 칼같이 분리됨.
 *
 * @param rawDepthCanvas  AI 모델 원본 저해상도 깊이 캔버스
 * @param guideCanvas     업샘플 목표 해상도의 컬러 이미지 캔버스
 * @returns               guideCanvas 해상도와 동일한 엣지 보존 깊이 캔버스
 */
function upsampleDepthJBU(
  rawDepthCanvas: HTMLCanvasElement,
  guideCanvas: HTMLCanvasElement
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

  // 5×5 Joint Bilateral: 공간 가우시안(σ=1.6) × 컬러 가우시안(σ²≈0.04)
  const fragSrc = `
    precision highp float;

    uniform sampler2D u_depth;
    uniform sampler2D u_guide;
    uniform vec2 u_depthSize;

    varying vec2 v_texCoord;

    void main() {
      vec3 guideCenter = texture2D(u_guide, v_texCoord).rgb;

      float sumDepth  = 0.0;
      float sumWeight = 0.0;

      for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
          vec2 offset    = vec2(float(dx), float(dy)) / u_depthSize;
          vec2 depthUV   = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
          vec2 guideUV   = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));

          float d = texture2D(u_depth, depthUV).r;
          vec3  g = texture2D(u_guide, guideUV).rgb;

          // 공간 가우시안 (σ=1.6 → 2σ²≈5.12)
          float spatialW = exp(-float(dx*dx + dy*dy) / 5.12);

          // 컬러 가우시안 (σ²≈0.04)
          vec3  cd = guideCenter - g;
          float colorW = exp(-dot(cd, cd) / 0.04);

          float w = spatialW * colorW;
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

  gl.uniform1i(gl.getUniformLocation(program, "u_depth"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_guide"), 1);
  gl.uniform2f(
    gl.getUniformLocation(program, "u_depthSize"),
    rawDepthCanvas.width,
    rawDepthCanvas.height
  );

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  if (depthTex) gl.deleteTexture(depthTex);
  if (guideTex) gl.deleteTexture(guideTex);
  if (buf) gl.deleteBuffer(buf);
  gl.deleteProgram(program);

  return glCanvas;
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

    for (let i = 0; i < W * H; i++) {
      const depth = depthPixels.data[i * 4] / 255;
      const inFocus = depth >= dFar && depth <= dNear;
      const base = i * 4;
      mask.data[base] = 255;
      mask.data[base + 1] = 255;
      mask.data[base + 2] = 255;
      mask.data[base + 3] = inFocus ? 0 : 255;
    }

    fallbackCtx.putImageData(mask, 0, 0);
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
    uniform vec2 u_resolution;

    varying vec2 v_texCoord;

    bool inFocusDepth(float depth) {
      return depth >= u_focusRange.x && depth <= u_focusRange.y;
    }

    void main() {
      float depth = texture2D(u_depthMap, v_texCoord).r;
      bool inFocus = inFocusDepth(depth);
      vec2 texel = 1.0 / u_resolution;
      bool neighborInFocus =
        inFocusDepth(texture2D(u_depthMap, clamp(v_texCoord + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).r) ||
        inFocusDepth(texture2D(u_depthMap, clamp(v_texCoord - vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).r) ||
        inFocusDepth(texture2D(u_depthMap, clamp(v_texCoord + vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).r) ||
        inFocusDepth(texture2D(u_depthMap, clamp(v_texCoord - vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).r);

      float alpha = inFocus ? 0.0 : (neighborInFocus ? 0.5 : 1.0);
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
  const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
  const [dFar, dNear] = focusRangeUiToDepthBounds(focusRange);

  gl.uniform1i(depthLocation, 0);
  gl.uniform2f(focusRangeLocation, dFar, dNear);
  gl.uniform2f(resolutionLocation, W, H);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  if (depthTexture) gl.deleteTexture(depthTexture);
  if (buffer) gl.deleteBuffer(buffer);
  gl.deleteProgram(program);

  return glCanvas;
}

function renderLensBlurWebGL(
  sourceCanvas: HTMLCanvasElement,
  blurRadius: number,
  depthData: Uint8Array,
  depthWidth: number,
  depthHeight: number,
  bokehShape: number,
  focusRange: [number, number]
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

    uniform sampler2D u_image;
    uniform sampler2D u_depthMap;
    uniform vec2 u_resolution;
    uniform float u_blurRadius;
    uniform float u_threshold;
    uniform vec2 u_focusRange;
    uniform int u_shape;

    varying vec2 v_texCoord;

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

    void main() {
      const float BOKEH_INTENSITY = 12.0;

      float centerDepth = texture2D(u_depthMap, v_texCoord).r;
      vec3  centerColor = texture2D(u_image,    v_texCoord).rgb;
      float centerLuma  = dot(centerColor, vec3(0.299, 0.587, 0.114));

      // ── CoC: Z-공간 역수 기반 물리 모델 ──────────────────────────────────
      float zCenter = 1.0 / (centerDepth      + 0.001);
      float zFar    = 1.0 / (u_focusRange.x   + 0.001);
      float zNear   = 1.0 / (u_focusRange.y   + 0.001);

      float coc = 0.0;
      if (zCenter > zNear) {
        coc = (zCenter - zNear) / zCenter;
      } else if (zCenter < zFar) {
        coc = (zFar - zCenter) / zFar;
      }

      float depthWeight  = clamp(coc * 8.0, 0.0, 1.0);
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

      // ── Bokeh 루프 ────────────────────────────────────────────────────────
      vec3  color       = vec3(0.0);
      float totalWeight = 0.0;

      // caOffset: 블러가 강할수록 색수차 반경 증가 (미세 디테일만)
      float caOffset = effectiveBlur * 0.0008;

      for (int i = 0; i < SAMPLES; i++) {
        float r     = sqrt(float(i) + 0.5) / sqrt(float(SAMPLES));
        float theta = float(i) * GOLDEN_ANGLE;
        vec2  shapePoint = vec2(cos(theta), sin(theta)) * r;

        if (!insideBokehShape(shapePoint, u_shape)) { continue; }

        vec2 offset     = shapePoint * (effectiveBlur / u_resolution);
        vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));

        // 색수차: R 바깥쪽 / B 안쪽으로 샘플 좌표 분리
        vec2 caDir = normalize(offset + vec2(1e-6)) * caOffset;
        vec4 sampleColor;
        sampleColor.r = texture2D(u_image, clamp(sampleCoord + caDir,        vec2(0.0), vec2(1.0))).r;
        sampleColor.g = texture2D(u_image, sampleCoord).g;
        sampleColor.b = texture2D(u_image, clamp(sampleCoord - caDir,        vec2(0.0), vec2(1.0))).b;
        sampleColor.a = 1.0;

        // ── Joint Bilateral: 깊이 + 밝기 차이로 경계 가중치 ─────────────
        float sampleDepth = texture2D(u_depthMap, sampleCoord).r;
        float sampleLuma  = dot(sampleColor.rgb, vec3(0.299, 0.587, 0.114));

        float depthDiff = abs(sampleDepth - centerDepth);
        float lumaDiff  = abs(sampleLuma  - centerLuma);

        float edgeWeight = exp(-(depthDiff * depthDiff * 40.0)
                              -(lumaDiff  * lumaDiff  *  10.0));

        float bokehWeight = 1.0 + pow(max(0.0, sampleLuma - u_threshold), 2.0) * BOKEH_INTENSITY;
        // Soap-bubble / rim: aperture 가장자리 샘플만 살짝 더 밝게(비눗방울 보케 느낌)
        float weight = bokehWeight * edgeWeight * (1.0 + smoothstep(0.52, 0.94, length(shapePoint)) * 0.55);

        color       += sampleColor.rgb * weight;
        totalWeight += weight;
      }

      // 초점면(Zero Blur): 가중 합이 없으면 원본 픽셀 100% (CA·오프셋 없음)
      if (totalWeight <= 0.0) {
        gl_FragColor = texture2D(u_image, v_texCoord);
        return;
      }

      vec3 blurred = color / totalWeight;
      // 경계 보호가 과하면 totalWeight가 작아져 노이즈·검게 죽는 현상 방지 → 원본 쪽으로 블렌딩
      float blurMix = smoothstep(0.35, 10.0, totalWeight);
      vec3 outRgb = mix(centerColor, blurred, blurMix);
      gl_FragColor = vec4(outRgb, 1.0);
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

  // JBU: 저해상도 깊이 맵을 guide 이미지 해상도로 엣지 보존 업샘플
  const rawDepthCanvas = createDepthTextureCanvas(depthData, depthWidth, depthHeight);
  const depthCanvas = upsampleDepthJBU(rawDepthCanvas, sourceCanvas);
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

  if (texture) gl.deleteTexture(texture);
  if (depthTexture) gl.deleteTexture(depthTexture);
  if (buffer) gl.deleteBuffer(buffer);
  gl.deleteProgram(program);

  return glCanvas;
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

  const lensBlurCanvas = renderLensBlurWebGL(
    downscaledCanvas,
    scaledBlurRadius,
    depthData,
    depthWidth,
    depthHeight,
    bokehShape,
    focusRange
  );

  const blurLayer = makeCanvas(W, H);
  const blurCtx = blurLayer.getContext("2d")!;
  blurCtx.imageSmoothingEnabled = true;
  blurCtx.imageSmoothingQuality = "high";
  blurCtx.drawImage(lensBlurCanvas, 0, 0, W, H);

  const rawDepthCanvas = createDepthTextureCanvas(depthData, depthWidth, depthHeight);
  let highResDepthCanvas: HTMLCanvasElement;
  try {
    highResDepthCanvas = upsampleDepthJBU(rawDepthCanvas, outCanvas);
  } catch (e) {
    console.warn("[compositeBlur] High-res JBU mask failed, linear depth fallback", e);
    highResDepthCanvas = makeCanvas(W, H);
    const depthCtx = highResDepthCanvas.getContext("2d")!;
    depthCtx.imageSmoothingEnabled = true;
    depthCtx.imageSmoothingQuality = "high";
    depthCtx.drawImage(rawDepthCanvas, 0, 0, W, H);
  }

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
  scaledCtx.drawImage(raw, 0, 0, targetW, targetH);
  return scaled;
}
