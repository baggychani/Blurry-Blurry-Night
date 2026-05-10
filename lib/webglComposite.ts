import { downloadCanvas } from "./canvasComposite";

export { downloadCanvas };

export interface CompositeOptions {
  image: HTMLImageElement;
  depthData: Uint8Array;
  depthWidth: number;
  depthHeight: number;
  blurRadius: number;
  bokehShape?: number;
  /** 초점 범위 [왼쪽%, 오른쪽%] 0~100. 왼쪽=가까움, 오른쪽=멀. 이 구간(깊이) 안은 선명 */
  focusRange?: [number, number];
}

const MAX_WEBGL_INPUT_EDGE = 1024;
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

export function drawMaskOverlay(
  outCanvas: HTMLCanvasElement,
  image: HTMLImageElement,
  depthData: Uint8Array,
  depthWidth: number,
  depthHeight: number,
  focusRange: [number, number] = [0, 100]
): void {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  outCanvas.width = W;
  outCanvas.height = H;

  const ctx = outCanvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0, W, H);

  const depthCanvas = createDepthTextureCanvas(depthData, depthWidth, depthHeight);
  const scaledDepthCanvas = makeCanvas(W, H);
  const scaledDepthCtx = scaledDepthCanvas.getContext("2d")!;
  scaledDepthCtx.imageSmoothingEnabled = true;
  scaledDepthCtx.imageSmoothingQuality = "high";
  scaledDepthCtx.drawImage(depthCanvas, 0, 0, W, H);

  const depthPixels = scaledDepthCtx.getImageData(0, 0, W, H);
  const overlay = ctx.createImageData(W, H);

  const [dFar, dNear] = focusRangeUiToDepthBounds(focusRange);

  for (let i = 0; i < W * H; i++) {
    const depth = depthPixels.data[i * 4] / 255;
    const [r, g, b] = turboLikeColor(depth);
    const base = i * 4;
    const inFocus = depth >= dFar && depth <= dNear;
    overlay.data[base] = r;
    overlay.data[base + 1] = g;
    overlay.data[base + 2] = b;
    // 초점 범위 안: 선명한 오버레이(alpha 200), 범위 밖: 어둡게(alpha 55)
    overlay.data[base + 3] = inFocus ? 200 : 55;
  }

  const overlayCanvas = makeCanvas(W, H);
  overlayCanvas.getContext("2d")!.putImageData(overlay, 0, 0);
  ctx.drawImage(overlayCanvas, 0, 0);
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

function createDownscaledCanvas(image: HTMLImageElement): {
  canvas: HTMLCanvasElement;
  scale: number;
} {
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const longEdge = Math.max(W, H);
  const scale = longEdge > MAX_WEBGL_INPUT_EDGE ? MAX_WEBGL_INPUT_EDGE / longEdge : 1;
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
    uniform float u_edgeSharpness;

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
      if (shape == 1) {
        return sdHexagon(p) <= 0.0;
      }
      if (shape == 2) {
        return sdHeart(p) <= 0.0;
      }
      if (shape == 3) {
        return sdStar(p) <= 0.0;
      }
      return length(p) <= 1.0;
    }

    void main() {
      vec3 color = vec3(0.0);
      float totalWeight = 0.0;
      float u_bokehIntensity = 12.0;
      float centerDepth = texture2D(u_depthMap, v_texCoord).r;

      // 초점 범위(u_focusRange)로부터 얼마나 벗어났는지 계산
      float distToFocus = 0.0;
      if (centerDepth < u_focusRange.x) {
        distToFocus = u_focusRange.x - centerDepth; // 초점보다 먼 곳
      } else if (centerDepth > u_focusRange.y) {
        distToFocus = centerDepth - u_focusRange.y; // 초점보다 가까운 곳
      }
      // distToFocus == 0 이면 초점 안(블러 0). 물리 렌즈의 CoC 전이 느낌으로 좁은 구간에서 급증
      float depthWeight = smoothstep(0.0, 0.25, distToFocus);
      float effectiveBlur = u_blurRadius * depthWeight;

      for (int i = 0; i < SAMPLES; i++) {
        float r = sqrt(float(i) + 0.5) / sqrt(float(SAMPLES));
        float theta = float(i) * GOLDEN_ANGLE;
        vec2 shapePoint = vec2(cos(theta), sin(theta)) * r;

        if (!insideBokehShape(shapePoint, u_shape)) {
          continue;
        }

        vec2 offset = shapePoint * (effectiveBlur / u_resolution);
        vec2 sampleCoord = clamp(v_texCoord + offset, vec2(0.0), vec2(1.0));
        vec4 sampleColor = texture2D(u_image, sampleCoord);

        // Bilateral: 깊이 불연속면에서 가중치 급감 → Edge Bleeding(전경 번짐) 방지
        float sampleDepth = texture2D(u_depthMap, sampleCoord).r;
        float depthDiff = abs(sampleDepth - centerDepth);
        float edgePreserve = exp(-depthDiff * u_edgeSharpness);

        float luma = dot(sampleColor.rgb, vec3(0.299, 0.587, 0.114));
        float bokehWeight = 1.0 + pow(max(0.0, luma - u_threshold), 2.0) * u_bokehIntensity;
        float weight = bokehWeight * edgePreserve;
        color += sampleColor.rgb * weight;
        totalWeight += weight;
      }

      if (totalWeight <= 0.0) {
        gl_FragColor = texture2D(u_image, v_texCoord);
        return;
      }

      gl_FragColor = vec4(color / totalWeight, 1.0);
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

  const depthCanvas = createDepthTextureCanvas(depthData, depthWidth, depthHeight);
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
  const edgeSharpnessLocation = gl.getUniformLocation(program, "u_edgeSharpness");

  gl.uniform1i(imageLocation, 0);
  gl.uniform1i(depthLocation, 1);
  gl.uniform2f(resolutionLocation, sourceCanvas.width, sourceCanvas.height);
  gl.uniform1f(blurRadiusLocation, blurRadius);
  gl.uniform1f(thresholdLocation, 0.6);
  const [dFar, dNear] = focusRangeUiToDepthBounds(focusRange);
  gl.uniform2f(focusRangeLocation, dFar, dNear);
  gl.uniform1i(shapeLocation, bokehShape);
  gl.uniform1f(edgeSharpnessLocation, 15.0);

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
  } = options;

  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const longEdge = Math.max(W, H);
  const actualBlur = (blurRadius / BLUR_SLIDER_MAX) * (longEdge * 0.012);

  outCanvas.width = W;
  outCanvas.height = H;
  const ctx = outCanvas.getContext("2d")!;

  const { canvas: downscaledCanvas, scale } = createDownscaledCanvas(image);
  const scaledBlurRadius = actualBlur * scale;

  const bgCanvas = makeCanvas(W, H);
  const bgCtx = bgCanvas.getContext("2d")!;

  if (scaledBlurRadius > 0) {
    const lensBlurCanvas = renderLensBlurWebGL(
      downscaledCanvas,
      scaledBlurRadius,
      depthData,
      depthWidth,
      depthHeight,
      bokehShape,
      focusRange
    );
    bgCtx.imageSmoothingEnabled = true;
    bgCtx.imageSmoothingQuality = "high";
    bgCtx.drawImage(lensBlurCanvas, 0, 0, W, H);
  } else {
    bgCtx.drawImage(image, 0, 0, W, H);
  }

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bgCanvas, 0, 0);
}
