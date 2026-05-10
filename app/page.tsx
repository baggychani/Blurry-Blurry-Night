"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";

import Header from "@/components/Header";
import UploadZone from "@/components/UploadZone";
import BottomSheet from "@/components/BottomSheet";
import CompareSlider from "@/components/CompareSlider";
import { useDepth } from "@/hooks/useDepth";
import {
  compositeBlur,
  drawMaskOverlay,
  downloadCanvas,
  type SubjectMask,
} from "@/lib/webglComposite";
import { growRegionFromPoint } from "@/lib/regionGrow";

/** 탭 투 포커스 시 초점 구간 너비 (UI percent 기준 ±) */
const FOCUS_TAP_WINDOW = 20;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function depthValueToFocusRange(depthValue: number): [number, number] {
  // UI는 왼쪽=가까움(depth 1), 오른쪽=멀리(depth 0)이므로 depth를 UI percent로 뒤집는다.
  const focusCenter = clampPercent(100 - (depthValue / 255) * 100);
  return [
    clampPercent(focusCenter - FOCUS_TAP_WINDOW),
    clampPercent(focusCenter + FOCUS_TAP_WINDOW),
  ];
}

function sampleDepthRangeAt(
  depth: { data: Uint8Array; width: number; height: number },
  xRatio: number,
  yRatio: number
): [number, number] {
  const x = Math.max(0, Math.min(depth.width - 1, Math.round(xRatio * (depth.width - 1))));
  const y = Math.max(0, Math.min(depth.height - 1, Math.round(yRatio * (depth.height - 1))));
  return depthValueToFocusRange(depth.data[y * depth.width + x] ?? 0);
}

export default function Home() {
  const [uploadedImage, setUploadedImage] = useState<HTMLImageElement | null>(null);
  const [blurRadius, setBlurRadius] = useState(10);
  const [isProcessing, setIsProcessing] = useState(false);
  const [maskMode, setMaskMode] = useState(false);
  const [bokehShape, setBokehShape] = useState(0);
  const [focusRange, setFocusRange] = useState<[number, number]>([0, 50]);
  const [histogramData, setHistogramData] = useState<number[]>([]);
  const [resultVersion, setResultVersion] = useState(0);
  const [hasTappedFocus, setHasTappedFocus] = useState(false);
  const [tapFocusMode, setTapFocusMode] = useState(false);
  const isProcessingRef = useRef(false);
  // ref로 최신 focusRange를 콜백에서 stale closure 없이 참조
  const focusRangeRef = useRef<[number, number]>([0, 50]);

  const depthDataRef = useRef<{
    data: Uint8Array;
    width: number;
    height: number;
  } | null>(null);

  // 블러 결과 캔버스 (CompareSlider의 "After"쪽 & 다운로드용)
  const resultCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 마스크 오버레이 전용 캔버스
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskOverlayRafRef = useRef(0);
  const resultInteractiveRafRef = useRef(0);
  const subjectMaskRef = useRef<SubjectMask | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { status: depthStatus, progress: depthProgress, estimateDepth } = useDepth();

  // ── 블러 결과를 resultCanvas에 그리기 ─────────────────────────────────────
  const renderResult = useCallback(
    (
      img: HTMLImageElement,
      blur: number,
      opts?: { blurInteractive?: boolean }
    ) => {
      if (!resultCanvasRef.current) {
        resultCanvasRef.current = document.createElement("canvas");
      }
      const canvas = resultCanvasRef.current;
      const depth = depthDataRef.current;

      if (!depth) {
        // Depth 없음 → 원본 그대로
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        }
        return;
      }

      compositeBlur(canvas, {
        image: img,
        depthData: depth.data,
        depthWidth: depth.width,
        depthHeight: depth.height,
        blurRadius: blur,
        bokehShape,
        focusRange: focusRangeRef.current,
        blurInteractive: opts?.blurInteractive ?? false,
        subjectMask: subjectMaskRef.current,
      });
    },
    [bokehShape]
  );

  // ── 마스크 오버레이를 maskCanvas에 그리기 ─────────────────────────────────
  const renderMaskOverlay = useCallback((img: HTMLImageElement) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const depth = depthDataRef.current;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!depth) {
      ctx.drawImage(img, 0, 0);
      return;
    }

    drawMaskOverlay(
      canvas,
      img,
      depth.data,
      depth.width,
      depth.height,
      focusRangeRef.current
    );
  }, []);

  /** 초점 슬라이더 드래그 중: 프레임당 1회 (WebGL 오버레이·저해상도 블러) */
  const scheduleFocusLiveUpdate = useCallback(
    (img: HTMLImageElement) => {
      if (maskOverlayRafRef.current) {
        cancelAnimationFrame(maskOverlayRafRef.current);
      }
      maskOverlayRafRef.current = requestAnimationFrame(() => {
        maskOverlayRafRef.current = 0;
        renderMaskOverlay(img);
      });
    },
    [renderMaskOverlay]
  );

  const scheduleResultInteractive = useCallback(
    (img: HTMLImageElement, blur: number) => {
      if (resultInteractiveRafRef.current) {
        cancelAnimationFrame(resultInteractiveRafRef.current);
      }
      resultInteractiveRafRef.current = requestAnimationFrame(() => {
        resultInteractiveRafRef.current = 0;
        renderResult(img, blur, { blurInteractive: true });
        setResultVersion((v) => v + 1);
      });
    },
    [renderResult]
  );

  useEffect(() => {
    return () => {
      if (maskOverlayRafRef.current) {
        cancelAnimationFrame(maskOverlayRafRef.current);
      }
      if (resultInteractiveRafRef.current) {
        cancelAnimationFrame(resultInteractiveRafRef.current);
      }
    };
  }, []);

  // ── 이미지 처리 (Depth 추정) ─────────────────────────────────────────────
  const processImage = useCallback(
    async (img: HTMLImageElement) => {
      if (isProcessingRef.current) {
        console.log("[App] 이미 AI가 처리 중입니다. 중복 실행을 차단합니다.");
        return;
      }

      isProcessingRef.current = true;
      setIsProcessing(true);
      try {
        const result = await estimateDepth(img);
        depthDataRef.current = result;
        console.log("[App] Depth 추정 성공:", `${result.width}x${result.height}`);

        // 256-bin 히스토그램 계산 → FocusRangeSlider 배경용
        const bins = new Array(256).fill(0) as number[];
        for (let i = 0; i < result.data.length; i++) {
          bins[result.data[i]]++;
        }
        setHistogramData(bins);
      } catch (err) {
        console.error("[App] processImage 오류:", err);
        depthDataRef.current = null;
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    },
    [estimateDepth]
  );

  // ── isProcessing 완료 시 렌더 트리거 ──────────────────────────────────────
  useEffect(() => {
    if (!isProcessing && uploadedImage) {
      renderResult(uploadedImage, blurRadius);
      setResultVersion((version) => version + 1);
      if (maskMode) renderMaskOverlay(uploadedImage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing, uploadedImage]);

  // ── 이미지 업로드 ─────────────────────────────────────────────────────────
  const handleImageLoad = useCallback(
    async (img: HTMLImageElement, _file: File) => {
      depthDataRef.current = null;
      resultCanvasRef.current = null;
      subjectMaskRef.current = null;
      setResultVersion(0);
      setMaskMode(false);
      setHistogramData([]);
      setHasTappedFocus(false);
      setTapFocusMode(false);
      // 새 이미지 업로드 시 초점 범위를 기본값으로 초기화
      focusRangeRef.current = [0, 50];
      setFocusRange([0, 50]);
      setUploadedImage(img);
      await processImage(img);
    },
    [processImage]
  );

  const handleNewImageClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleNewFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        Promise.resolve(handleImageLoad(img, file)).finally(() => {
          URL.revokeObjectURL(url);
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [handleImageLoad]
  );

  // ── 초점 범위 슬라이더 ────────────────────────────────────────────────────
  const handleFocusRangeChange = useCallback(
    (range: [number, number]) => {
      focusRangeRef.current = range;
      setFocusRange(range);
      if (!uploadedImage || isProcessing) return;
      if (maskMode) {
        scheduleFocusLiveUpdate(uploadedImage);
      } else {
        scheduleResultInteractive(uploadedImage, blurRadius);
      }
    },
    [
      uploadedImage,
      isProcessing,
      maskMode,
      scheduleFocusLiveUpdate,
      scheduleResultInteractive,
      blurRadius,
    ]
  );

  const handleFocusRangeCommit = useCallback(
    (range: [number, number]) => {
      focusRangeRef.current = range;
      setFocusRange(range);
      if (!uploadedImage || isProcessing) return;
      if (maskOverlayRafRef.current) {
        cancelAnimationFrame(maskOverlayRafRef.current);
        maskOverlayRafRef.current = 0;
      }
      if (resultInteractiveRafRef.current) {
        cancelAnimationFrame(resultInteractiveRafRef.current);
        resultInteractiveRafRef.current = 0;
      }
      if (maskMode) {
        renderMaskOverlay(uploadedImage);
      } else {
        renderResult(uploadedImage, blurRadius, { blurInteractive: false });
      }
      setResultVersion((v) => v + 1);
    },
    [
      uploadedImage,
      isProcessing,
      maskMode,
      blurRadius,
      renderMaskOverlay,
      renderResult,
    ]
  );

  const handleTapFocus = useCallback(
    (point: { xRatio: number; yRatio: number }) => {
      const depth = depthDataRef.current;
      if (!uploadedImage || !depth || isProcessing) return;

      // 초점 범위: 탭한 지점의 깊이값 기반
      const nextRange = sampleDepthRangeAt(depth, point.xRatio, point.yRatio);
      focusRangeRef.current = nextRange;
      setFocusRange(nextRange);

      setHasTappedFocus(true);

      // Subject Lock: 탭한 물체를 색상 기반 region grow로 추출
      try {
        const mask = growRegionFromPoint(uploadedImage, point.xRatio, point.yRatio);
        subjectMaskRef.current = mask;
      } catch (e) {
        console.warn("[TapFocus] regionGrow 실패, subject mask 없이 진행:", e);
        subjectMaskRef.current = null;
      }

      // 탭은 드래그가 아니라 단발성 이벤트이므로 풀 품질 렌더
      if (maskOverlayRafRef.current) {
        cancelAnimationFrame(maskOverlayRafRef.current);
        maskOverlayRafRef.current = 0;
      }
      if (resultInteractiveRafRef.current) {
        cancelAnimationFrame(resultInteractiveRafRef.current);
        resultInteractiveRafRef.current = 0;
      }

      if (maskMode) {
        renderMaskOverlay(uploadedImage);
      } else {
        renderResult(uploadedImage, blurRadius, { blurInteractive: false });
        setResultVersion((v) => v + 1);
      }
    },
    [
      uploadedImage,
      isProcessing,
      maskMode,
      blurRadius,
      renderMaskOverlay,
      renderResult,
    ]
  );

  // ── 블러 슬라이더 ─────────────────────────────────────────────────────────
  const handleBlurChange = useCallback(
    (value: number) => {
      setBlurRadius(value);
      if (uploadedImage && !isProcessing) {
        renderResult(uploadedImage, value);
        setResultVersion((version) => version + 1);
      }
    },
    [uploadedImage, isProcessing, renderResult]
  );

  useEffect(() => {
    if (uploadedImage && !isProcessing && !maskMode) {
      renderResult(uploadedImage, blurRadius);
      setResultVersion((version) => version + 1);
    }
  }, [bokehShape, uploadedImage, isProcessing, maskMode, blurRadius, renderResult]);

  // ── 마스크 모드 토글 ─────────────────────────────────────────────────────
  const handleMaskModeToggle = useCallback(() => {
    const next = !maskMode;
    if (!next) {
      if (maskOverlayRafRef.current) {
        cancelAnimationFrame(maskOverlayRafRef.current);
        maskOverlayRafRef.current = 0;
      }
    }
    setMaskMode(next);
    if (next && uploadedImage && !isProcessing) {
      requestAnimationFrame(() => renderMaskOverlay(uploadedImage));
    }
  }, [maskMode, uploadedImage, isProcessing, renderMaskOverlay]);

  // ── 다운로드 ─────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!resultCanvasRef.current || !uploadedImage) return;
    // 저장 직전 풀 해상도·풀 품질 블러로 동기화 (프리뷰 1024 경로와 무관하게 원본 크기 보장)
    if (depthDataRef.current) {
      renderResult(uploadedImage, blurRadius, { blurInteractive: false });
    }
    downloadCanvas(resultCanvasRef.current, `bbn-${Date.now()}`, "jpeg", 0.98);
  }, [uploadedImage, blurRadius, renderResult]);

  return (
    <main
      className="flex flex-col bg-black"
      style={{ height: "100dvh", overflow: "hidden" }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleNewFileChange}
      />

      <Header status={depthStatus} progress={depthProgress} />

      {/* 프리뷰 영역 */}
      <div className="flex-1 relative mx-1 sm:mx-2 mt-1 mb-0 overflow-hidden rounded-t-xl bg-zinc-950 min-h-0">
        {uploadedImage ? (
          <>
            {/* AI 처리 중 오버레이 */}
            {isProcessing && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm rounded-2xl">
                <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mb-3" />
                <p className="text-white text-sm font-medium">AI 분석 중...</p>
                <p className="text-zinc-400 text-xs mt-1">거리 정보를 계산하고 있어요</p>
              </div>
            )}

            {/* 마스크 모드 */}
            {maskMode ? (
              <>
                {/* CompareSlider와 동일: 부모를 꽉 채운 뒤 캔버스만 비율 유지 축소 */}
                <div className="absolute inset-0 overflow-hidden rounded-2xl">
                  <canvas
                    ref={maskCanvasRef}
                    className="absolute inset-0 m-auto max-w-full max-h-full block"
                  />
                </div>
                {!isProcessing && !depthDataRef.current && (
                  <div className="absolute top-3 inset-x-0 flex justify-center z-10 pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-sm border border-red-500/40 text-red-300 text-xs font-medium px-3 py-1.5 rounded-lg">
                      거리 맵 추정 실패 — 원본 이미지를 표시합니다
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Before/After 비교 슬라이더 — 항상 표시 */
              resultCanvasRef.current && (
                <div className="absolute inset-0">
                  <CompareSlider
                    originalImage={uploadedImage}
                    resultCanvas={resultCanvasRef.current}
                    tapFocusMode={tapFocusMode}
                    onTapFocus={handleTapFocus}
                    renderKey={`${blurRadius}-${bokehShape}-${focusRange[0]}-${focusRange[1]}-${resultVersion}`}
                  />
                  {!tapFocusMode && !hasTappedFocus && !isProcessing && (
                    <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none z-10">
                      <div className="flex items-center gap-2 bg-black/70 backdrop-blur-sm border border-white/15 text-white text-xs font-medium px-3.5 py-2 rounded-full shadow-lg">
                        <span className="text-center px-1">
                          아래 「탭으로 초점 맞추기」를 켠 뒤 사진을 탭하세요
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </>
        ) : (
          <div className="absolute inset-0 p-4">
            <UploadZone onImageLoad={handleImageLoad} />
          </div>
        )}
      </div>

      <AnimatePresence>
        {uploadedImage && (
          <BottomSheet
            blurRadius={blurRadius}
            onBlurChange={handleBlurChange}
            onNewImage={handleNewImageClick}
            onDownload={handleDownload}
            isProcessing={isProcessing}
            maskMode={maskMode}
            onMaskModeToggle={handleMaskModeToggle}
            bokehShape={bokehShape}
            onBokehShapeChange={setBokehShape}
            focusRange={focusRange}
            onFocusRangeChange={handleFocusRangeChange}
            onFocusRangeCommit={handleFocusRangeCommit}
            histogramData={histogramData}
            tapFocusMode={tapFocusMode}
            onTapFocusModeToggle={() => setTapFocusMode((v) => !v)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
