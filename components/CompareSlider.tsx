"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface CompareSliderProps {
  originalImage: HTMLImageElement;
  resultCanvas: HTMLCanvasElement;
  /** 블러 값이 바꿀 때마다 resultCanvas 내용을 다시 반영하기 위한 키 */
  renderKey: string;
  /** true일 때만 사진 탭이 초점 변경으로 처리됨 (슬라이더 분리와 겹치지 않음) */
  tapFocusMode: boolean;
  /** 이미지 표시 영역 안에서의 탭 좌표(0~1) */
  onTapFocus?: (point: { xRatio: number; yRatio: number }) => void;
}

const TAP_MOVE_THRESHOLD_PX = 12;

/**
 * Before / After 비교 슬라이더
 * - tapFocusMode 꺼짐: 포인터로 핸들 드래그·배경 탭으로 분할선만 이동 (초점 변경 없음)
 * - tapFocusMode 켜짐: 블러 결과만 표시, 탭으로 초점만 지정
 */
export default function CompareSlider({
  originalImage,
  resultCanvas,
  renderKey,
  tapFocusMode,
  onTapFocus,
}: CompareSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const beforeCanvasRef = useRef<HTMLCanvasElement>(null);
  const afterCanvasRef = useRef<HTMLCanvasElement>(null);

  const [splitX, setSplitX] = useState(0.5);
  const handleDraggingRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const movedPastThresholdRef = useRef(false);

  useEffect(() => {
    const canvas = beforeCanvasRef.current;
    if (!canvas) return;
    canvas.width = originalImage.naturalWidth;
    canvas.height = originalImage.naturalHeight;
    canvas.getContext("2d")?.drawImage(originalImage, 0, 0);
  }, [originalImage]);

  useEffect(() => {
    const canvas = afterCanvasRef.current;
    if (!canvas) return;
    canvas.width = resultCanvas.width;
    canvas.height = resultCanvas.height;
    canvas.getContext("2d")?.drawImage(resultCanvas, 0, 0);
  }, [resultCanvas, renderKey]);

  const getRelativeX = useCallback((clientX: number): number => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return splitX;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, [splitX]);

  const getImagePoint = useCallback(
    (clientX: number, clientY: number): { xRatio: number; yRatio: number } | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;

      const imageAspect = originalImage.naturalWidth / originalImage.naturalHeight;
      const containerAspect = rect.width / rect.height;
      const displayW = containerAspect > imageAspect ? rect.height * imageAspect : rect.width;
      const displayH = containerAspect > imageAspect ? rect.height : rect.width / imageAspect;
      const offsetX = rect.left + (rect.width - displayW) / 2;
      const offsetY = rect.top + (rect.height - displayH) / 2;
      const xRatio = (clientX - offsetX) / displayW;
      const yRatio = (clientY - offsetY) / displayH;

      if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
        return null;
      }

      return { xRatio, yRatio };
    },
    [originalImage]
  );

  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    if (tapFocusMode) return;
    e.stopPropagation();
    e.preventDefault();
    handleDraggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [tapFocusMode]);

  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!handleDraggingRef.current || tapFocusMode) return;
      setSplitX(getRelativeX(e.clientX));
    },
    [getRelativeX, tapFocusMode]
  );

  const onHandlePointerUp = useCallback((e: React.PointerEvent) => {
    if (handleDraggingRef.current) {
      handleDraggingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const onContainerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (tapFocusMode) {
        pointerStartRef.current = { x: e.clientX, y: e.clientY };
        movedPastThresholdRef.current = false;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      } else if (!handleDraggingRef.current) {
        pointerStartRef.current = { x: e.clientX, y: e.clientY };
        movedPastThresholdRef.current = false;
      }
    },
    [tapFocusMode]
  );

  const onContainerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = pointerStartRef.current;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_MOVE_THRESHOLD_PX) {
        movedPastThresholdRef.current = true;
      }
      if (handleDraggingRef.current && !tapFocusMode) {
        setSplitX(getRelativeX(e.clientX));
      }
    },
    [getRelativeX, tapFocusMode]
  );

  const onContainerPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (tapFocusMode) {
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }

      if (e.pointerType === "mouse" && e.button !== 0) {
        pointerStartRef.current = null;
        return;
      }

      const start = pointerStartRef.current;
      pointerStartRef.current = null;

      if (handleDraggingRef.current || movedPastThresholdRef.current || !start) {
        movedPastThresholdRef.current = false;
        return;
      }

      const point = getImagePoint(e.clientX, e.clientY);
      if (!point) {
        movedPastThresholdRef.current = false;
        return;
      }

      if (tapFocusMode) {
        onTapFocus?.(point);
      } else {
        setSplitX(getRelativeX(e.clientX));
      }
      movedPastThresholdRef.current = false;
    },
    [getImagePoint, getRelativeX, onTapFocus, tapFocusMode]
  );

  const onContainerPointerCancel = useCallback((e: React.PointerEvent) => {
    if (tapFocusMode) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    pointerStartRef.current = null;
    movedPastThresholdRef.current = false;
    handleDraggingRef.current = false;
  }, [tapFocusMode]);

  const splitPercent = `${(splitX * 100).toFixed(2)}%`;
  const showSplit = !tapFocusMode;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden rounded-2xl select-none ${
        tapFocusMode ? "cursor-crosshair touch-manipulation" : "cursor-col-resize touch-manipulation"
      }`}
      style={{ touchAction: "manipulation" }}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
      onPointerCancel={onContainerPointerCancel}
    >
      <canvas
        ref={afterCanvasRef}
        className="absolute inset-0 m-auto max-w-full max-h-full"
        style={{ display: "block", top: 0, bottom: 0, left: 0, right: 0 }}
      />

      {showSplit && (
        <>
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ clipPath: `inset(0 ${(1 - splitX) * 100}% 0 0)` }}
          >
            <canvas
              ref={beforeCanvasRef}
              className="absolute inset-0 m-auto max-w-full max-h-full"
              style={{ display: "block", top: 0, bottom: 0, left: 0, right: 0 }}
            />
          </div>

          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] pointer-events-none"
            style={{ left: splitPercent }}
          />

          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 touch-none"
            style={{ left: splitPercent, touchAction: "none" }}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
          >
            <div className="w-10 h-10 rounded-full bg-white shadow-xl flex items-center justify-center gap-0.5">
              <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
                <path
                  d="M6 1L1 6L6 11"
                  stroke="black"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
                <path
                  d="M2 1L7 6L2 11"
                  stroke="black"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
            <div className="grid grid-cols-[6rem_auto_6rem] items-center bg-black/65 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full border border-white/10">
              <span className="text-zinc-300 text-right pr-2">← 원본</span>
              <span className="text-zinc-600 text-center">|</span>
              <span className="text-blue-200 text-left pl-2">블러 결과 →</span>
            </div>
          </div>
        </>
      )}

      {tapFocusMode && (
        <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
          <div className="bg-black/65 backdrop-blur-sm text-sky-200 text-xs font-medium px-3 py-1.5 rounded-full border border-sky-500/30">
            탭하여 초점 맞추기
          </div>
        </div>
      )}
    </div>
  );
}
