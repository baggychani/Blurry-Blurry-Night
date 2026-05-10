import type { MetadataRoute } from "next";

/** 정적 내보내기(output: export) 호환 */
export const dynamic = "force-static";

const base = process.env.NEXT_BASE_PATH?.trim() || "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Blurry Blurry Night",
    short_name: "BBN",
    description: "AI로 사진 배경을 블러 처리하는 무료 웹앱. 모든 연산은 브라우저에서.",
    start_url: `${base}/` || "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "portrait",
    icons: [
      {
        src: `${base}/icons/icon-192x192.svg`,
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: `${base}/icons/icon-512x512.svg`,
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
