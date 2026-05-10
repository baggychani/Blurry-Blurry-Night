"use client";

import { useEffect, useRef, useState } from "react";
import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";

export type SegmenterStatus = "idle" | "loading" | "ready" | "error";

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite";

const MAX_SEGMENT_INPUT_SIZE = 1024;

function makeSegmentationInput(
  imageElement: HTMLImageElement | HTMLCanvasElement
): HTMLImageElement | HTMLCanvasElement {
  const width =
    imageElement instanceof HTMLImageElement
      ? imageElement.naturalWidth
      : imageElement.width;
  const height =
    imageElement instanceof HTMLImageElement
      ? imageElement.naturalHeight
      : imageElement.height;

  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_SEGMENT_INPUT_SIZE) {
    return imageElement;
  }

  const scale = MAX_SEGMENT_INPUT_SIZE / longEdge;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return imageElement;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function useSegmenter() {
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const [status, setStatus] = useState<SegmenterStatus>("idle");

  useEffect(() => {
    let cancelled = false;
    const originalConsoleError = console.error;

    // TensorFlow Lite가 정상 초기화 정보도 stderr(console.error)로 내보내서
    // Next.js 개발 오버레이가 오류처럼 보여주는 문제를 정확히 이 로그만 우회합니다.
    console.error = (...args: Parameters<typeof console.error>) => {
      const first = String(args[0] ?? "");
      if (first.includes("INFO: Created TensorFlow Lite XNNPACK delegate for CPU")) {
        console.info(...args);
        return;
      }
      originalConsoleError(...args);
    };

    async function init() {
      setStatus("loading");
      try {
        console.log("[Segmenter] 초기화 시작...");
        const vision = await import("@mediapipe/tasks-vision");
        const { ImageSegmenter, FilesetResolver } = vision;

        console.log("[Segmenter] WASM 로드 중...");
        const filesetResolver = await FilesetResolver.forVisionTasks(WASM_PATH);

        console.log("[Segmenter] 모델 로드 중...");
        const segmenter = await ImageSegmenter.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "CPU",
          },
          outputCategoryMask: false,
          outputConfidenceMasks: true,
          runningMode: "IMAGE",
        });

        if (!cancelled) {
          segmenterRef.current = segmenter;
          setStatus("ready");
          console.log("[Segmenter] 준비 완료!");
        } else {
          segmenter.close();
        }
      } catch (err) {
        console.error("[Segmenter] 초기화 실패:", err);
        if (!cancelled) setStatus("error");
      }
    }

    init();
    return () => {
      cancelled = true;
      segmenterRef.current?.close();
      segmenterRef.current = null;
      console.error = originalConsoleError;
    };
  }, []);

  async function segment(
    imageElement: HTMLImageElement | HTMLCanvasElement
  ): Promise<ImageSegmenterResult | null> {
    let waited = 0;
    while (!segmenterRef.current && waited < 30000) {
      await new Promise((r) => setTimeout(r, 200));
      waited += 200;
    }

    if (!segmenterRef.current) {
      console.warn("[Segmenter] 타임아웃: 세그멘터 미준비");
      return null;
    }

    try {
      const input = makeSegmentationInput(imageElement);
      console.log(
        "[Segmenter] 분석 시작, 이미지 크기:",
        input instanceof HTMLImageElement
          ? `${input.naturalWidth}x${input.naturalHeight}`
          : `${input.width}x${input.height}`
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const result = segmenterRef.current.segment(input);
      console.log(
        "[Segmenter] 결과:",
        result ? `confidenceMasks: ${result.confidenceMasks?.length ?? 0}개` : "null"
      );
      return result;
    } catch (err) {
      console.error("[Segmenter] segment 실패:", err);
      return null;
    }
  }

  return { status, segment };
}
