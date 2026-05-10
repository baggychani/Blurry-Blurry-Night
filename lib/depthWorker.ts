/// <reference lib="webworker" />

import "./depthWorkerInit";
import { env, pipeline } from "@xenova/transformers";

env.allowLocalModels = false;
if (!env.backends) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env as any).backends = {};
}
if (!env.backends.onnx) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env.backends as any).onnx = {};
}
if (!env.backends.onnx.wasm) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env.backends.onnx as any).wasm = {};
}
env.backends.onnx.wasm.wasmPaths =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/";
env.useBrowserCache = true;

type DepthWorkerRequest =
  | {
      type: "load";
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

function post(response: DepthWorkerResponse, transfer?: Transferable[]) {
  self.postMessage(response, { transfer });
}

function getEstimator() {
  if (!depthEstimatorPromise) {
    depthEstimatorPromise = pipeline(
      "depth-estimation",
      "Xenova/depth-anything-small-hf",
      {
        quantized: true,
        progress_callback: (progress: DepthProgress) => {
          console.log("[DepthWorker] 상태:", progress);
          post({ type: "progress", data: progress });
        },
      }
    );
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

function normalizeDepth(depth: RawDepthImage): Uint8Array {
  const source = depth.data;
  const pixelCount = depth.width * depth.height;
  const output = new Uint8Array(pixelCount);

  if (source instanceof Uint8Array || source instanceof Uint8ClampedArray) {
    if (source.length === pixelCount) {
      output.set(source);
      return output;
    }

    if (source.length >= pixelCount * 4) {
      for (let i = 0; i < pixelCount; i++) {
        output[i] = source[i * 4];
      }
      return output;
    }

    output.set(source.slice(0, pixelCount));
    return output;
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pixelCount; i++) {
    const value = source[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = Math.max(1e-6, max - min);
  for (let i = 0; i < pixelCount; i++) {
    output[i] = Math.max(0, Math.min(255, Math.round(((source[i] - min) / range) * 255)));
  }

  return output;
}

self.onmessage = async (event: MessageEvent<DepthWorkerRequest>) => {
  const message = event.data;

  try {
    if (message.type === "load") {
      await getEstimator();
      post({ type: "ready" });
      return;
    }

    if (message.type === "estimate") {
      const estimator = await getEstimator();
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
