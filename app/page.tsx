"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";

import Header from "@/components/Header";
import UploadZone from "@/components/UploadZone";
import BottomSheet from "@/components/BottomSheet";
import CompareSlider from "@/components/CompareSlider";
import { useDepth } from "@/hooks/useDepth";
import { compositeBlur, drawMaskOverlay, downloadCanvas } from "@/lib/webglComposite";

export default function Home() {
  const [uploadedImage, setUploadedImage] = useState<HTMLImageElement | null>(null);
  const [blurRadius, setBlurRadius] = useState(10);
  const [isProcessing, setIsProcessing] = useState(false);
  const [maskMode, setMaskMode] = useState(false);
  const [bokehShape, setBokehShape] = useState(0);
  const [focusRange, setFocusRange] = useState<[number, number]>([0, 50]);
  const [histogramData, setHistogramData] = useState<number[]>([]);
  const [resultVersion, setResultVersion] = useState(0);
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { status: depthStatus, progress: depthProgress, estimateDepth } = useDepth();

  // ── 블러 결과를 resultCanvas에 그리기 ─────────────────────────────────────
  const renderResult = useCallback(
    (img: HTMLImageElement, blur: number) => {
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

    // 항상 원본 먼저 그림
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    if (!depth) {
      // Depth가 없으면 원본만 표시하고, 안내 메시지는 UI 레이어에서
      return;
    }

    // Depth 오버레이 추가 (focusRangeRef로 최신 초점 범위 전달)
    drawMaskOverlay(canvas, img, depth.data, depth.width, depth.height, focusRangeRef.current);
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
      setResultVersion(0);
      setMaskMode(false);
      setHistogramData([]);
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
        renderMaskOverlay(uploadedImage);
      } else {
        renderResult(uploadedImage, blurRadius);
        setResultVersion((v) => v + 1);
      }
    },
    [uploadedImage, isProcessing, maskMode, renderMaskOverlay, renderResult, blurRadius]
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
    setMaskMode(next);
    if (next && uploadedImage && !isProcessing) {
      // 마스크 캔버스를 다음 렌더 사이클에서 그리도록 requestAnimationFrame 사용
      requestAnimationFrame(() => renderMaskOverlay(uploadedImage));
    }
  }, [maskMode, uploadedImage, isProcessing, renderMaskOverlay]);

  // ── 다운로드 ─────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!resultCanvasRef.current) return;
    downloadCanvas(resultCanvasRef.current, `bbn-${Date.now()}`, "jpeg", 0.95);
  }, []);

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
      <div className="flex-1 relative mx-2 sm:mx-4 my-2 overflow-hidden rounded-2xl bg-zinc-950 min-h-0">
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
                <canvas
                  ref={maskCanvasRef}
                  className="absolute inset-0 m-auto max-w-full max-h-full"
                  style={{ display: "block", top: 0, bottom: 0, left: 0, right: 0 }}
                />
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
                    // 처리 완료 시마다 슬라이더 내부를 갱신하기 위한 키
                    renderKey={`${blurRadius}-${bokehShape}-${focusRange[0]}-${focusRange[1]}-${resultVersion}`}
                  />
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
            histogramData={histogramData}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
