"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  onFocusRangeCommit: (range: [number, number]) => void;
  histogramData: number[];
  /** 켜면 사진 탭만 초점 변경, 비교 슬라이더는 블러 결과만 표시 */
  tapFocusMode: boolean;
  onTapFocusModeToggle: () => void;
}

const BLUR_MAX = 30;

/** 접힘/펼침 모두 동일 — 새 사진·저장 버튼 공통 스타일 */
const PRIMARY_BTN_NEW =
  "flex items-center justify-center gap-2 rounded-xl min-h-[2.75rem] py-2 px-4 text-sm font-medium transition-all duration-150 active:scale-95 bg-zinc-800 hover:bg-zinc-700 text-white disabled:opacity-40 disabled:cursor-not-allowed";
const PRIMARY_BTN_SAVE =
  "flex items-center justify-center gap-2 rounded-xl min-h-[2.75rem] py-2 px-4 text-sm font-semibold transition-all duration-150 active:scale-95 bg-white hover:bg-zinc-100 text-black disabled:opacity-40 disabled:cursor-not-allowed";

function PrimaryActionRow({
  isProcessing,
  maskMode,
  onNewImage,
  onDownload,
}: {
  isProcessing: boolean;
  maskMode: boolean;
  onNewImage: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="button" onClick={onNewImage} disabled={isProcessing} className={PRIMARY_BTN_NEW}>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        새 사진
      </button>
      <button type="button" onClick={onDownload} disabled={isProcessing || maskMode} className={PRIMARY_BTN_SAVE}>
        {isProcessing ? (
          <>
            <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-black/30 border-t-black" />
            처리 중...
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M8.25 9.75 12 13.5m0 0 3.75-3.75M12 13.5V3" />
            </svg>
            저장하기
          </>
        )}
      </button>
    </div>
  );
}

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
  onFocusRangeCommit,
  histogramData,
  tapFocusMode,
  onTapFocusModeToggle,
}: BottomSheetProps) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [bokehOpen, setBokehOpen] = useState(false);

  return (
    <motion.div
      initial={{ y: "100%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
      className="flex-shrink-0 w-full max-w-3xl mx-auto bg-zinc-900 border border-b-0 border-zinc-800 rounded-t-3xl px-4 sm:px-5 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {/* 접기/펼치기 — 화살표만, 테두리 없음 */}
      <div className="flex justify-center py-1">
        <button
          type="button"
          aria-expanded={panelOpen}
          aria-label={panelOpen ? "편집 패널 접기" : "편집 패널 펼치기"}
          onClick={() => setPanelOpen((v) => !v)}
          className="flex h-7 w-10 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-200 active:scale-95"
        >
          <motion.svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
            animate={{ rotate: panelOpen ? 0 : 180 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
          </motion.svg>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!panelOpen && (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
            style={{ overflow: "hidden" }}
            className="mb-1"
          >
            <PrimaryActionRow
              isProcessing={isProcessing}
              maskMode={maskMode}
              onNewImage={onNewImage}
              onDownload={onDownload}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {panelOpen && (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
            style={{ overflow: "hidden" }}
          >
            {/* 보케 모양 — 헤더 클릭으로 접기/펼치기 */}
            <div className="mb-2">
              <button
                type="button"
                onClick={() => setBokehOpen((v) => !v)}
                disabled={isProcessing}
                className="flex w-full items-center justify-between py-0.5 text-left disabled:opacity-40"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-400 text-xs font-medium leading-none">보케 모양</span>
                  {/* 현재 선택된 보케 미리보기 */}
                  <span className="text-zinc-500 flex items-center w-3.5 h-3.5">
                    <BokehShapeGlyph shapeId={bokehShape} />
                  </span>
                </div>
                <motion.svg
                  className="h-3.5 w-3.5 text-zinc-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden
                  animate={{ rotate: bokehOpen ? 0 : 180 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
                </motion.svg>
              </button>
              <AnimatePresence initial={false}>
                {bokehOpen && (
                  <motion.div
                    key="bokeh-open"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
                    style={{ overflow: "hidden" }}
                    className="pt-2"
                  >
                    <div className="grid grid-cols-4 gap-2">
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
                              h-9 rounded-xl border
                              flex items-center justify-center
                              transition-all duration-150 disabled:opacity-40
                              ${
                                selected
                                  ? "bg-white text-black border-white shadow-[0_0_14px_rgba(255,255,255,0.15)]"
                                  : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white hover:bg-zinc-700"
                              }
                            `}
                          >
                            <BokehShapeGlyph shapeId={shape.id} />
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 탭 초점 + 거리 맵 */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={onTapFocusModeToggle}
                disabled={isProcessing || maskMode}
                title={tapFocusMode ? "탭 초점 끄기 (비교 슬라이더)" : "탭으로 초점 맞추기"}
                className={`
                  min-h-[2.75rem] flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2
                  text-[13px] font-medium rounded-xl py-2 px-2 sm:px-3 text-center leading-tight
                  transition-all duration-150 disabled:opacity-40
                  ${
                    tapFocusMode
                      ? "bg-sky-500/25 text-sky-200 border border-sky-500/50"
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
                  className="w-4 h-4 shrink-0"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59"
                  />
                </svg>
                <span className="hidden sm:inline">
                  {tapFocusMode ? "탭 초점 끄기" : "탭으로 초점 맞추기"}
                </span>
                <span className="sm:hidden">{tapFocusMode ? "탭 초점 끄기" : "탭 초점"}</span>
              </button>
              <button
                type="button"
                onClick={onMaskModeToggle}
                disabled={isProcessing}
                title={maskMode ? "거리 맵 확인 종료" : "거리 맵 확인"}
                className={`
                  min-h-[2.75rem] flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2
                  text-[13px] font-medium rounded-xl py-2 px-2 sm:px-3 text-center leading-tight
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
                  className="w-4 h-4 shrink-0"
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
                <span className="hidden sm:inline">{maskMode ? "거리 맵 종료" : "거리 맵 확인"}</span>
                <span className="sm:hidden">{maskMode ? "맵 끄기" : "거리 맵"}</span>
              </button>
            </div>
            {tapFocusMode && (
              <p className="text-zinc-500 text-xs mb-2 text-center -mt-1">
                사진을 탭하면 그 위치에 초점이 맞습니다
              </p>
            )}

            {/* 초점 범위 (Focus Range) — 건드리지 않음 */}
            <div className="mb-1.5">
              <div className="flex items-center justify-between mb-1.5 sm:mb-2.5">
                <span className="text-white text-sm font-medium">초점 범위</span>
                <span className="text-zinc-500 text-xs">Focus Range</span>
              </div>
              <FocusRangeSlider
                value={focusRange}
                onChange={onFocusRangeChange}
                onCommit={onFocusRangeCommit}
                histogramData={histogramData}
                disabled={isProcessing || tapFocusMode}
              />
            </div>

            {/* 블러 강도 슬라이더 — 건드리지 않음 */}
            <div className="mb-3">
              <div className="mb-2">
                <span className="text-white text-sm font-medium">배경 블러 강도</span>
              </div>

              <div className="flex items-center gap-3">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0"
                >
                  <circle cx="12" cy="12" r="7" />
                </svg>

                <div className="relative flex-1 h-5 flex items-center">
                  <div className="absolute left-0 right-0 h-1.5 rounded-full bg-zinc-600" />
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
                  <div
                    className="absolute w-5 h-5 rounded-full bg-white shadow-md border border-zinc-200 -translate-x-1/2 pointer-events-none"
                    style={{ left: `${(blurRadius / BLUR_MAX) * 100}%` }}
                  />
                </div>

                <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                  <div
                    className="w-3.5 h-3.5 rounded-full bg-zinc-400"
                    style={{ filter: "blur(2px)" }}
                  />
                </div>
              </div>
            </div>

            <PrimaryActionRow
              isProcessing={isProcessing}
              maskMode={maskMode}
              onNewImage={onNewImage}
              onDownload={onDownload}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
