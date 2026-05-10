"use client";

import { motion } from "framer-motion";
import FocusRangeSlider from "./FocusRangeSlider";

interface BottomSheetProps {
  blurRadius: number;
  onBlurChange: (value: number) => void;
  onNewImage: () => void;
  onDownload: () => void;
  isProcessing: boolean;
  maskMode: boolean;
  onMaskModeToggle: () => void;
  bokehShape: number;
  onBokehShapeChange: (shape: number) => void;
  focusRange: [number, number];
  onFocusRangeChange: (range: [number, number]) => void;
  histogramData: number[];
}

const BLUR_MAX = 30;
const BOKEH_SHAPES = [
  { id: 0, label: "원형" },
  { id: 1, label: "육각형" },
  { id: 2, label: "하트" },
  { id: 3, label: "별" },
];

function BokehShapeGlyph({ shapeId }: { shapeId: number }) {
  const cn = "w-5 h-5 shrink-0";
  switch (shapeId) {
    case 0:
      return (
        <svg viewBox="0 0 24 24" className={cn} aria-hidden>
          <circle cx="12" cy="12" r="6.5" fill="currentColor" />
        </svg>
      );
    case 1:
      return (
        <svg viewBox="0 0 24 24" className={cn} aria-hidden>
          <path
            fill="currentColor"
            d="M12 4.2 17.33 7.3 17.33 13.5 12 16.6 6.67 13.5 6.67 7.3z"
          />
        </svg>
      );
    case 2:
      return (
        <svg viewBox="0 0 24 24" className={cn} aria-hidden>
          <path
            fill="currentColor"
            d="M12 20.35l-.4-.35C7.1 16.1 4 12.55 4 9.25A4.25 4.25 0 0 1 8.25 5c1.45 0 2.85.7 3.75 1.8A4.24 4.24 0 0 1 15.75 5 4.25 4.25 0 0 1 20 9.25c0 3.3-3.1 6.85-7.6 10.75l-.4.35z"
          />
        </svg>
      );
    case 3:
      return (
        <svg viewBox="0 0 24 24" className={cn} aria-hidden>
          <path
            fill="currentColor"
            d="M12 2.8l2.65 6.75h6.95l-5.45 4.15 2.08 6.5L12 16.35 6.77 20.2l2.08-6.5L3.4 9.55h6.95L12 2.8z"
          />
        </svg>
      );
    default:
      return null;
  }
}

export default function BottomSheet({
  blurRadius,
  onBlurChange,
  onNewImage,
  onDownload,
  isProcessing,
  maskMode,
  onMaskModeToggle,
  bokehShape,
  onBokehShapeChange,
  focusRange,
  onFocusRangeChange,
  histogramData,
}: BottomSheetProps) {
  return (
    <motion.div
      initial={{ y: "100%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
      className="flex-shrink-0 w-full max-w-3xl mx-auto bg-zinc-900 border border-b-0 border-zinc-800 rounded-t-3xl px-4 sm:px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-[max(2rem,env(safe-area-inset-bottom))]"
    >
      {/* 드래그 핸들 */}
      <div className="w-10 h-1 rounded-full bg-zinc-700 mx-auto mb-4" />

      {/* 보케 모양 (SVG, 라벨 없음) */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {BOKEH_SHAPES.map((shape) => {
          const selected = bokehShape === shape.id;
          return (
            <button
              key={shape.id}
              type="button"
              aria-label={shape.label}
              title={shape.label}
              onClick={() => onBokehShapeChange(shape.id)}
              disabled={isProcessing}
              className={`
                  h-10 rounded-xl border
                  flex items-center justify-center
                  transition-all duration-150 disabled:opacity-40
                  ${
                    selected
                      ? "bg-white text-black border-white shadow-[0_0_18px_rgba(255,255,255,0.18)]"
                      : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white hover:bg-zinc-700"
                  }
                `}
            >
              <BokehShapeGlyph shapeId={shape.id} />
            </button>
          );
        })}
      </div>

      {/* 거리 맵 확인 버튼 (단독) */}
      <div className="mb-4">
        <button
          onClick={onMaskModeToggle}
          disabled={isProcessing}
          className={`
            w-full flex items-center justify-center gap-2
            text-sm font-medium rounded-xl py-2.5 px-3
            transition-all duration-150 disabled:opacity-40
            ${
              maskMode
                ? "bg-red-500/20 text-red-300 border border-red-500/40"
                : "bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700 hover:text-zinc-200"
            }
          `}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            className="w-4 h-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
          </svg>
          {maskMode ? "거리 맵 확인 종료" : "거리 맵 확인"}
        </button>
      </div>

      {/* 초점 범위 (Focus Range) */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-white text-sm font-medium">초점 범위</span>
          <span className="text-zinc-500 text-xs">Focus Range</span>
        </div>
        <FocusRangeSlider
          value={focusRange}
          onChange={onFocusRangeChange}
          histogramData={histogramData}
          disabled={isProcessing}
        />
        {maskMode && (
          <p className="text-zinc-500 text-xs mt-2 text-center">
            밝게 표시된 영역이 현재 초점 범위입니다
          </p>
        )}
      </div>

      {/* 블러 강도 슬라이더 */}
      <div className="mb-5">
        <div className="mb-3">
          <span className="text-white text-sm font-medium">배경 블러 강도</span>
        </div>

        <div className="flex items-center gap-3">
          {/* 블러 약함 */}
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0"
          >
            <circle cx="12" cy="12" r="7" />
          </svg>

          <div className="relative flex-1 h-5 flex items-center">
            {/* 커스텀 트랙 */}
            <div className="absolute left-0 right-0 h-1.5 rounded-full bg-zinc-600" />
            {/* 채워진 트랙 */}
            <div
              className="absolute left-0 h-1.5 rounded-full bg-white"
              style={{ width: `${(blurRadius / BLUR_MAX) * 100}%` }}
            />
            <input
              type="range"
              min={0}
              max={BLUR_MAX}
              step={1}
              value={blurRadius}
              onChange={(e) => onBlurChange(Number(e.target.value))}
              className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
            />
            {/* 썸 */}
            <div
              className="absolute w-5 h-5 rounded-full bg-white shadow-md border border-zinc-200 -translate-x-1/2 pointer-events-none"
              style={{ left: `${(blurRadius / BLUR_MAX) * 100}%` }}
            />
          </div>

          {/* 블러 강함 */}
          <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
            <div
              className="w-3.5 h-3.5 rounded-full bg-zinc-400"
              style={{ filter: "blur(2px)" }}
            />
          </div>
        </div>
      </div>

      {/* 하단 버튼 */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onNewImage}
          disabled={isProcessing}
          className="
            flex items-center justify-center gap-2
            bg-zinc-800 hover:bg-zinc-700 active:scale-95
            text-white text-sm font-medium
            rounded-2xl py-4 px-4
            transition-all duration-150
            disabled:opacity-40 disabled:cursor-not-allowed
          "
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
            />
          </svg>
          새 사진
        </button>

        <button
          onClick={onDownload}
          disabled={isProcessing || maskMode}
          className="
            flex items-center justify-center gap-2
            bg-white hover:bg-zinc-100 active:scale-95
            text-black text-sm font-semibold
            rounded-2xl py-4 px-4
            transition-all duration-150
            disabled:opacity-40 disabled:cursor-not-allowed
          "
        >
          {isProcessing ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              처리 중...
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M8.25 9.75 12 13.5m0 0 3.75-3.75M12 13.5V3"
                />
              </svg>
              저장하기
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
