"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DepthStatus = "idle" | "loading_model" | "ready" | "estimating" | "error";

export interface DepthResult {
  data: Uint8Array;
  width: number;
  height: number;
}

type PendingRequest = {
  resolve: (result: DepthResult) => void;
  reject: (error: Error) => void;
};

type DepthWorkerResponse =
  | {
      type: "ready";
    }
  | {
      type: "progress";
      data: {
        progress?: number;
        loaded?: number;
        total?: number;
      };
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

const MAX_DEPTH_INPUT_EDGE = 1024;

function imageToDataUrl(image: HTMLImageElement): string {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const longEdge = Math.max(width, height);
  const scale = longEdge > MAX_DEPTH_INPUT_EDGE ? MAX_DEPTH_INPUT_EDGE / longEdge : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas is not available");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", 0.92);
}

export function useDepth() {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(new Map<number, PendingRequest>());
  const [status, setStatus] = useState<DepthStatus>("idle");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const worker = new Worker(new URL("../lib/depthWorker.ts", import.meta.url), {
      type: "module",
    });

    workerRef.current = worker;
    setStatus("loading_model");

    worker.onmessage = (event: MessageEvent<DepthWorkerResponse>) => {
      const message = event.data;

      if (message.type === "ready") {
        setProgress(100);
        setStatus("ready");
        return;
      }

      if (message.type === "progress") {
        const directProgress = message.data.progress;
        const calculatedProgress =
          typeof message.data.loaded === "number" &&
          typeof message.data.total === "number" &&
          message.data.total > 0
            ? (message.data.loaded / message.data.total) * 100
            : undefined;

        const nextProgress = directProgress ?? calculatedProgress;
        if (typeof nextProgress === "number" && Number.isFinite(nextProgress)) {
          setProgress(Math.max(0, Math.min(100, Math.round(nextProgress))));
        }
        return;
      }

      if (message.type === "result") {
        const pending = pendingRef.current.get(message.id);
        if (!pending) return;

        pendingRef.current.delete(message.id);
        setStatus("ready");
        pending.resolve({
          data: message.data,
          width: message.width,
          height: message.height,
        });
        return;
      }

      if (message.type === "error") {
        if (typeof message.id === "number") {
          const pending = pendingRef.current.get(message.id);
          if (pending) {
            pendingRef.current.delete(message.id);
            pending.reject(new Error(message.error));
          }
        }
        setStatus("error");
      }
    };

    worker.onerror = (event) => {
      console.error("[useDepth] worker error:", event.message);
      setProgress(0);
      setStatus("error");
    };

    worker.postMessage({ type: "load" });

    return () => {
      pendingRef.current.forEach((pending) => {
        pending.reject(new Error("Depth worker was terminated"));
      });
      pendingRef.current.clear();
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const estimateDepth = useCallback((image: HTMLImageElement): Promise<DepthResult> => {
    const worker = workerRef.current;
    if (!worker) {
      return Promise.reject(new Error("Depth worker is not ready"));
    }

    setStatus("estimating");
    const id = requestIdRef.current++;
    const imageDataUrl = imageToDataUrl(image);

    return new Promise<DepthResult>((resolve, reject) => {
      pendingRef.current.set(id, { resolve, reject });
      worker.postMessage({ type: "estimate", id, imageDataUrl });
    });
  }, []);

  return { status, progress, estimateDepth };
}
