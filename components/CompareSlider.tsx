"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface CompareSliderProps {
  originalImage: HTMLImageElement;
  resultCanvas: HTMLCanvasElement;
  /** 블러 값이 바뀔 때마다 resultCanvas 내용을 다시 반영하기 위한 키 */
  renderKey: string;
}

/**
 * Before / After 비교 슬라이더
 * - 항상 화면에 표시
 * - 기본값: 50:50 → 원본과 블러 결과를 동시에 확인
 * - 핸들 드래그/클릭으로 경계 이동
 * - 핸들 아이콘: 좌우 화살표 (‹ ›)
 */
export default function CompareSlider({
  originalImage,
  resultCanvas,
  renderKey,
}: CompareSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const beforeCanvasRef = useRef<HTMLCanvasElement>(null);
  const afterCanvasRef = useRef<HTMLCanvasElement>(null);

  // splitX는 원본(Before)이 보이는 비율입니다. 기본 0.5로 절반 비교를 보여줍니다.
  const [splitX, setSplitX] = useState(0.5);
  const isDragging = useRef(false);

  // 원본 이미지를 before 캔버스에 그리기
  useEffect(() => {
    const canvas = beforeCanvasRef.current;
    if (!canvas) return;
    canvas.width = originalImage.naturalWidth;
    canvas.height = originalImage.naturalHeight;
    canvas.getContext("2d")?.drawImage(originalImage, 0, 0);
  }, [originalImage]);

  // 결과 캔버스를 after 캔버스에 복사 (renderKey 바뀔 때마다 갱신)
  useEffect(() => {
    const canvas = afterCanvasRef.current;
    if (!canvas) return;
    canvas.width = resultCanvas.width;
    canvas.height = resultCanvas.height;
    canvas.getContext("2d")?.drawImage(resultCanvas, 0, 0);
  }, [resultCanvas, renderKey]);

  const getRelativeX = useCallback(
    (clientX: number): number => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return splitX;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    },
    [splitX]
  );

  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    isDragging.current = true;
  }, []);

  const onMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDragging.current) return;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      setSplitX(getRelativeX(clientX));
    },
    [getRelativeX]
  );

  const onDragEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  // 컨테이너 클릭으로도 선 이동
  const onContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current) {
        setSplitX(getRelativeX(e.clientX));
      }
    },
    [getRelativeX]
  );

  const splitPercent = `${(splitX * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden rounded-2xl select-none cursor-col-resize"
      onMouseMove={onMove}
      onMouseUp={onDragEnd}
      onMouseLeave={onDragEnd}
      onTouchMove={onMove}
      onTouchEnd={onDragEnd}
      onClick={onContainerClick}
    >
      {/* After (블러 결과) — 전체 크기 배경 */}
      <canvas
        ref={afterCanvasRef}
        className="absolute inset-0 m-auto max-w-full max-h-full"
        style={{ display: "block", top: 0, bottom: 0, left: 0, right: 0 }}
      />

      {/* Before (원본) — 왼쪽 clip */}
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

      {/* 구분선 */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] pointer-events-none"
        style={{ left: splitPercent }}
      />

      {/* 핸들 */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 touch-none"
        style={{ left: splitPercent }}
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
      >
        <div className="w-10 h-10 rounded-full bg-white shadow-xl flex items-center justify-center gap-0.5">
          {/* 왼쪽 화살표 */}
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
            <path
              d="M6 1L1 6L6 11"
              stroke="black"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {/* 오른쪽 화살표 */}
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

      {/* 방향 레이블: 중앙 구분선을 기준으로 좌우 텍스트 폭을 같게 맞춤 */}
      <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
        <div className="grid grid-cols-[6rem_auto_6rem] items-center bg-black/65 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full border border-white/10">
          <span className="text-zinc-300 text-right pr-2">← 원본</span>
          <span className="text-zinc-600 text-center">|</span>
          <span className="text-blue-200 text-left pl-2">블러 결과 →</span>
        </div>
      </div>
    </div>
  );
}
