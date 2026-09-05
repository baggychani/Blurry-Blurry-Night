import { useEffect, useState } from "react";

/**
 * "모바일"(터치/좁은 화면) vs "데스크톱" 판정 — depth 모델 등급 선택과
 * 인터랙티브 렌더 지연시간 조절에서 공통으로 쓰는 기준.
 */
export function isMobileLikeDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse), (max-width: 640px)").matches;
}

export type DeviceTier = "mobile" | "desktop";

export function getDeviceTier(): DeviceTier {
  return isMobileLikeDevice() ? "mobile" : "desktop";
}

/**
 * 좌우 배치(lg) 레이아웃 진입 여부 — Tailwind `lg:` 브레이크포인트(1024px)와 동일 기준.
 * 리사이즈에 반응해야 하는 순수 시각적 분기(예: 마운트 애니메이션 on/off)에 사용.
 */
export function useIsDesktopLayout(breakpointPx = 1024): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(min-width: ${breakpointPx}px)`).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpointPx}px)`);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpointPx]);

  return isDesktop;
}
