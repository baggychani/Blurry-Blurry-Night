"use client";

import { useEffect, useRef } from "react";

interface FocusRangeSliderProps {
  value: [number, number];
  onChange: (range: [number, number]) => void;
  /** 포인터를 뗄 때(드래그 종료) 풀 품질 렌더 등에 사용 */
  onCommit?: (range: [number, number]) => void;
  histogramData?: number[];
  disabled?: boolean;
}

function turboColor(t: number): [number, number, number] {
  const stops: Array<[number, number, number, number]> = [
    [0.0, 48, 18, 59],
    [0.2, 50, 100, 190],
    [0.4, 40, 200, 220],
    [0.6, 100, 220, 80],
    [0.8, 245, 180, 40],
    [1.0, 230, 55, 35],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const lt = (t - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1] + (b[1] - a[1]) * lt),
        Math.round(a[2] + (b[2] - a[2]) * lt),
        Math.round(a[3] + (b[3] - a[3]) * lt),
      ];
    }
  }
  return [230, 55, 35];
}

/** 모바일 권장 최소 터치 폭 (약 44px) */
const EDGE_HIT = 44;

/** 히스토그램 트랙 높이 — 낮은 직사각형 */
const TRACK_H = 36;

/** 막대 최대 높이 비율 (트랙 대비, 낮출수록 더 낮은 히스토그램) */
const BAR_MAX_FRAC = 0.68;

/** 초점 윈도우 안쪽 테두리 (inset ring) */
const INSET_RING = "inset 0 0 0 2px rgba(255,255,255,0.92)";

export default function FocusRangeSlider({
  value,
  onChange,
  onCommit,
  histogramData,
  disabled = false,
}: FocusRangeSliderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<[number, number]>(value);
  const dragRef = useRef<{
    mode: "left" | "right" | "body";
    startPct: number;
    startRange: [number, number];
  } | null>(null);

  const halfHit = EDGE_HIT / 2;

  useEffect(() => {
    pendingRef.current = value;
  }, [value]);

  /* ── Histogram 캔버스 그리기 ───────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = window.devicePixelRatio ?? 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      const W = rect.width;
      const H = rect.height;

      ctx.fillStyle = "#18181b";
      ctx.fillRect(0, 0, W, H);

      if (histogramData && histogramData.length > 0) {
        const bins = histogramData.length;
        const maxCount = Math.max(...histogramData);
        if (maxCount > 0) {
          const bw = W / bins;
          for (let i = 0; i < bins; i++) {
            const t = i / (bins - 1);
            const [r, g, b] = turboColor(t);
            const bh = (histogramData[i] / maxCount) * H * BAR_MAX_FRAC;
            ctx.fillStyle = `rgba(${r},${g},${b},0.78)`;
            const x = W - (i + 1) * bw;
            ctx.fillRect(x, H - bh, bw + 0.5, bh);
          }
        }
      } else {
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0, "rgba(230,55,35,0.22)");
        grad.addColorStop(0.45, "rgba(40,200,220,0.22)");
        grad.addColorStop(1, "rgba(48,18,59,0.22)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [histogramData]);

  const getPercent = (clientX: number): number => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const hadDrag = dragRef.current !== null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    if (hadDrag && onCommit) {
      onCommit(pendingRef.current);
    }
  };

  const makeHandlers = (mode: "left" | "right" | "body") => ({
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      pendingRef.current = [value[0], value[1]];
      dragRef.current = {
        mode,
        startPct: getPercent(e.clientX),
        startRange: [value[0], value[1]],
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      const drag = dragRef.current;
      if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId) || disabled) return;
      const pct = getPercent(e.clientX);
      const { mode: m, startPct, startRange } = drag;
      let next: [number, number];
      if (m === "left") {
        next = [Math.round(Math.min(pct, value[1] - 6)), value[1]];
      } else if (m === "right") {
        next = [value[0], Math.round(Math.max(pct, value[0] + 6))];
      } else {
        const w = startRange[1] - startRange[0];
        const delta = pct - startPct;
        const newMin = Math.max(0, Math.min(100 - w, startRange[0] + delta));
        next = [Math.round(newMin), Math.round(newMin + w)];
      }
      onChange(next);
      pendingRef.current = next;
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  const [min, max] = value;

  return (
    <div
      className={
        disabled
          ? "opacity-40 pointer-events-none select-none"
          : "select-none touch-manipulation"
      }
    >
      <div
        ref={containerRef}
        className="relative rounded-lg overflow-hidden touch-none"
        style={{ height: TRACK_H, WebkitTouchCallout: "none" as const }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        <div
          className="absolute inset-y-0 left-0 bg-black/55 pointer-events-none"
          style={{ width: `${min}%` }}
        />

        <div
          className="absolute inset-y-0 right-0 bg-black/55 pointer-events-none"
          style={{ width: `${100 - max}%` }}
        />

        {/* 선택 윈도우: 안쪽으로 두꺼운 테두리 (inset ring) */}
        <div
          className="absolute inset-y-0 pointer-events-none rounded-[inherit]"
          style={{
            left: `${min}%`,
            width: `${max - min}%`,
            boxShadow: INSET_RING,
          }}
        />

        <div
          {...makeHandlers("left")}
          className="absolute inset-y-0 z-20 flex items-center justify-center cursor-ew-resize"
          style={{ left: `calc(${min}% - ${halfHit}px)`, width: EDGE_HIT }}
          role="slider"
          aria-label="초점 범위 왼쪽"
        >
          <div className="w-0.5 h-6 rounded-full bg-white/95 shadow pointer-events-none" />
        </div>

        <div
          {...makeHandlers("body")}
          className="absolute inset-y-0 z-10 cursor-grab active:cursor-grabbing"
          style={{
            left: `calc(${min}% + ${halfHit}px)`,
            width: `max(0px, calc(${max - min}% - ${EDGE_HIT}px))`,
          }}
        />

        <div
          {...makeHandlers("right")}
          className="absolute inset-y-0 z-20 flex items-center justify-center cursor-ew-resize"
          style={{ left: `calc(${max}% - ${halfHit}px)`, width: EDGE_HIT }}
          role="slider"
          aria-label="초점 범위 오른쪽"
        >
          <div className="w-0.5 h-6 rounded-full bg-white/95 shadow pointer-events-none" />
        </div>
      </div>

      <div className="flex justify-between mt-1.5">
        <span className="text-zinc-500 text-xs">← 가까이</span>
        <span className="text-zinc-400 text-xs font-mono tabular-nums">
          {min}% - {max}%
        </span>
        <span className="text-zinc-500 text-xs">멀리 →</span>
      </div>
    </div>
  );
}
