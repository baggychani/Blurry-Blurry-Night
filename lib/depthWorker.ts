/// <reference lib="webworker" />

import "./depthWorkerInit";
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

/**
 * 모바일: 가볍고 빠른 V2 Small(WASM/CPU, 기존 V1 small과 동급 비용).
 * 데스크톱 + WebGPU 지원 시: V2 Large(WebGPU) — 같은 GPU 자원을 그냥 놀리지 않고 훨씬
 * 정교한 depth map을 뽑아낸다. Large는 CC-BY-NC-4.0(비상업)이라 상업적 재배포 시 주의.
 */
const SMALL_MODEL_ID = "onnx-community/depth-anything-v2-small";
const LARGE_MODEL_ID = "onnx-community/depth-anything-v2-large";

type DeviceTier = "mobile" | "desktop";

type DepthWorkerRequest =
  | {
      type: "load";
      tier?: DeviceTier;
    }
  | {
      type: "estimate";
      id: number;
      imageDataUrl: string;
    };

type DepthWorkerResponse =
  | {
      type: "ready";
    }
  | {
      type: "progress";
      data: DepthProgress;
    }
  | {
      type: "result";
      id: number;
      data: Uint8Array;
      width: number;
      height: number;
    }
  | {
      type: "error";
      id?: number;
      error: string;
    };

type RawDepthImage = {
  data: Uint8Array | Uint8ClampedArray | Float32Array;
  width: number;
  height: number;
};

type DepthProgress = {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

let depthEstimatorPromise: Promise<unknown> | null = null;
// "load" 메시지에서 정해진 뒤 이후 "estimate" 호출에서도 재사용 (getEstimator는 최초 1회만 실행)
let resolvedTier: DeviceTier = "mobile";

function post(response: DepthWorkerResponse, transfer?: Transferable[]) {
  self.postMessage(response, { transfer });
}

function supportsWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function loadSmallModel(onProgress: (p: DepthProgress) => void) {
  // dtype 미지정 시 wasm 디바이스는 자동으로 q8(양자화)을 쓴다 (transformers.js 기본값)
  return pipeline("depth-estimation", SMALL_MODEL_ID, {
    progress_callback: onProgress,
  });
}

function getEstimator(tier: DeviceTier) {
  if (depthEstimatorPromise) return depthEstimatorPromise;

  const onProgress = (progress: DepthProgress) => {
    console.log("[DepthWorker] 상태:", progress);
    post({ type: "progress", data: progress });
  };

  if (tier === "desktop" && supportsWebGPU()) {
    console.log("[DepthWorker] 데스크톱 + WebGPU 감지 → V2 Large 로드");
    depthEstimatorPromise = pipeline("depth-estimation", LARGE_MODEL_ID, {
      device: "webgpu",
      dtype: "q4f16",
      progress_callback: onProgress,
    }).catch((e) => {
      console.warn("[DepthWorker] WebGPU Large 모델 로드 실패, Small(WASM)로 대체:", e);
      return loadSmallModel(onProgress);
    });
  } else {
    depthEstimatorPromise = loadSmallModel(onProgress);
  }

  return depthEstimatorPromise;
}

function isRawDepthImage(value: unknown): value is RawDepthImage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    "data" in candidate &&
    "width" in candidate &&
    "height" in candidate &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

function extractDepthImage(result: unknown): RawDepthImage {
  if (typeof result !== "object" || result === null) {
    throw new Error("Depth result is empty");
  }

  const record = result as Record<string, unknown>;
  const depth = record.depth ?? record.predicted_depth;

  if (!isRawDepthImage(depth)) {
    throw new Error("Depth result does not contain an image-like depth map");
  }

  return depth;
}

function stretchUint8Depth(values: Uint8Array): Uint8Array {
  const pixelCount = values.length;
  const hist = new Uint32Array(256);
  for (let i = 0; i < pixelCount; i++) hist[values[i]]++;

  const lowTarget = Math.max(0, Math.floor(pixelCount * 0.01));
  const highTarget = Math.max(0, Math.floor(pixelCount * 0.99));
  let cumulative = 0;
  let low = 0;
  let high = 255;

  for (let i = 0; i < 256; i++) {
    cumulative += hist[i];
    if (cumulative >= lowTarget) {
      low = i;
      break;
    }
  }

  cumulative = 0;
  for (let i = 0; i < 256; i++) {
    cumulative += hist[i];
    if (cumulative >= highTarget) {
      high = i;
      break;
    }
  }

  if (high - low < 8) return values;

  const output = new Uint8Array(pixelCount);
  const range = high - low;
  for (let i = 0; i < pixelCount; i++) {
    output[i] = Math.max(0, Math.min(255, Math.round(((values[i] - low) / range) * 255)));
  }
  return output;
}

function stretchFloatDepth(source: Float32Array, pixelCount: number): Uint8Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pixelCount; i++) {
    const value = source[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) {
    return new Uint8Array(pixelCount);
  }

  const bins = 1024;
  const hist = new Uint32Array(bins);
  const rawRange = max - min;
  for (let i = 0; i < pixelCount; i++) {
    const value = source[i];
    if (!Number.isFinite(value)) continue;
    const bin = Math.max(
      0,
      Math.min(bins - 1, Math.floor(((value - min) / rawRange) * (bins - 1)))
    );
    hist[bin]++;
  }

  const lowTarget = Math.max(0, Math.floor(pixelCount * 0.01));
  const highTarget = Math.max(0, Math.floor(pixelCount * 0.99));
  let cumulative = 0;
  let lowBin = 0;
  let highBin = bins - 1;

  for (let i = 0; i < bins; i++) {
    cumulative += hist[i];
    if (cumulative >= lowTarget) {
      lowBin = i;
      break;
    }
  }

  cumulative = 0;
  for (let i = 0; i < bins; i++) {
    cumulative += hist[i];
    if (cumulative >= highTarget) {
      highBin = i;
      break;
    }
  }

  const low = min + (lowBin / (bins - 1)) * rawRange;
  const high = min + (highBin / (bins - 1)) * rawRange;
  const range = Math.max(1e-6, high - low);
  const output = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const value = Number.isFinite(source[i]) ? source[i] : low;
    output[i] = Math.max(0, Math.min(255, Math.round(((value - low) / range) * 255)));
  }

  return output;
}

function normalizeDepth(depth: RawDepthImage): Uint8Array {
  const source = depth.data;
  const pixelCount = depth.width * depth.height;

  if (source instanceof Uint8Array || source instanceof Uint8ClampedArray) {
    const gray = new Uint8Array(pixelCount);

    if (source.length === pixelCount) {
      gray.set(source);
      return stretchUint8Depth(gray);
    }

    if (source.length >= pixelCount * 4) {
      for (let i = 0; i < pixelCount; i++) {
        gray[i] = source[i * 4];
      }
      return stretchUint8Depth(gray);
    }

    gray.set(source.slice(0, pixelCount));
    return stretchUint8Depth(gray);
  }

  return stretchFloatDepth(source, pixelCount);
}
self.onmessage = async (event: MessageEvent<DepthWorkerRequest>) => {
  const message = event.data;

  try {
    if (message.type === "load") {
      resolvedTier = message.tier ?? "mobile";
      await getEstimator(resolvedTier);
      post({ type: "ready" });
      return;
    }

    if (message.type === "estimate") {
      const estimator = await getEstimator(resolvedTier);
      const result = await (estimator as (input: string) => Promise<unknown>)(
        message.imageDataUrl
      );
      const depth = extractDepthImage(result);
      const data = normalizeDepth(depth);

      post(
        {
          type: "result",
          id: message.id,
          data,
          width: depth.width,
          height: depth.height,
        },
        [data.buffer]
      );
    }
  } catch (err) {
    post({
      type: "error",
      id: message.type === "estimate" ? message.id : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
