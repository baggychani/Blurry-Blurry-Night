"use client";

import { DepthStatus } from "@/hooks/useDepth";

interface HeaderProps {
  status: DepthStatus;
  progress: number;
}

const statusConfig: Record<DepthStatus, { text: string; color: string }> = {
  idle: { text: "준비 중...", color: "text-zinc-500" },
  loading_model: { text: "Depth 모델 로딩 중...", color: "text-amber-400" },
  ready: { text: "AI 준비 완료", color: "text-emerald-400" },
  estimating: { text: "거리 계산 중...", color: "text-amber-400" },
  error: { text: "모델 로드 실패", color: "text-red-400" },
};

// 밤하늘 로고 SVG
function NightSkyLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 원형 배경 - 짙은 남색 */}
      <circle cx="14" cy="14" r="14" fill="#0f172a" />
      {/* 달 */}
      <path
        d="M18.5 10.5C17.5 10.2 16.4 10.1 15.3 10.4C12.5 11.2 10.8 14.1 11.6 16.9C12.1 18.7 13.5 20 15.2 20.5C13.3 21.2 11.1 20.9 9.5 19.5C7.2 17.5 7.1 14 9.2 11.9C11 10 13.7 9.6 16 10.5C16.9 10.8 17.7 11.4 18.5 10.5Z"
        fill="#e2e8f0"
      />
      {/* 별 1 - 크게 */}
      <circle cx="21" cy="8" r="1.2" fill="white" opacity="0.9" />
      {/* 별 2 */}
      <circle cx="19" cy="5" r="0.8" fill="white" opacity="0.7" />
      {/* 별 3 */}
      <circle cx="24" cy="12" r="0.7" fill="white" opacity="0.6" />
      {/* 별 4 - 반짝임 */}
      <circle cx="22.5" cy="6" r="0.5" fill="#93c5fd" opacity="0.9" />
      {/* 별 5 */}
      <circle cx="6" cy="7" r="0.6" fill="white" opacity="0.5" />
      {/* 별 6 */}
      <circle cx="4" cy="11" r="0.4" fill="white" opacity="0.4" />
    </svg>
  );
}

export default function Header({ status, progress }: HeaderProps) {
  const { text, color } = statusConfig[status];
  const loadingProgress = Math.max(0, Math.min(100, progress));
  const statusText =
    status === "loading_model" ? `AI 모델 다운로드 중... (${loadingProgress}%)` : text;

  return (
    <header className="flex items-center justify-between px-5 py-4 flex-shrink-0">
      {/* 로고 */}
      <div className="flex items-center gap-2 min-w-0">
        <NightSkyLogo />
        <div className="flex flex-col leading-none min-w-0">
          <span className="text-white font-semibold text-sm sm:text-lg tracking-tight truncate">
            Blurry{" "}
            <span
              className="font-light"
              style={{
                background: "linear-gradient(90deg, #93c5fd, #c4b5fd)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Blurry
            </span>{" "}
            <span className="text-zinc-400 font-light">Night</span>
          </span>
          <span className="mt-1 text-[9px] sm:text-[10px] uppercase tracking-[0.22em] text-zinc-600">
            by Baggychani
          </span>
        </div>
      </div>

      {/* 모델 상태 표시 */}
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          {(status === "loading_model" || status === "estimating") && (
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
          {status === "ready" && (
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
          )}
          {status === "error" && (
            <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
          )}
          <span className={`text-[10px] sm:text-xs font-medium ${color}`}>
            {statusText}
          </span>
        </div>
        {status === "loading_model" && (
          <div className="h-1 w-24 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-amber-400 transition-all duration-300"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
        )}
      </div>
    </header>
  );
}
