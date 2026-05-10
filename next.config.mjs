import path from "path";
import { fileURLToPath } from "url";
import withPWAInit from "@ducanh2912/next-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** GitHub Pages 프로젝트 사이트(user.github.io/레포이름)일 때 CI에서만 설정 */
const basePath = process.env.NEXT_BASE_PATH?.trim() || "";

const withPWA = withPWAInit({
  dest: "public",
  // 개발 환경에서는 서비스 워커 비활성화 (핫 리로드 간섭 방지)
  disable: process.env.NODE_ENV === "development",
  // 오프라인 폴백 (GitHub Pages basePath 배포 시 경로 맞춤)
  fallbacks: {
    document: `${basePath}/offline`,
  },
  // 캐시 전략 설정
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  workboxOptions: {
    disableDevLogs: true,
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // GitHub Pages 등 정적 호스팅용 (서버 없이 out/ 배포)
  output: "export",
  images: {
    unoptimized: true,
  },
  ...(basePath ? { basePath } : {}),

  // Turbopack(기본): 브라우저/워커 번들에서 Node 코어 모듈 → 스텁
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/empty-node-stub.js" },
      path: { browser: "./lib/empty-node-stub.js" },
      sharp: { browser: "./lib/empty-node-stub.js" },
      "onnxruntime-node": { browser: "./lib/empty-node-stub.js" },
    },
  },
  // next build --webpack 등에서 동일 스텁 적용
  webpack: (config, { isServer }) => {
    if (!isServer) {
      const emptyStub = path.join(__dirname, "lib", "empty-node-stub.js");
      config.resolve.alias = {
        ...config.resolve.alias,
        sharp: false,
        "onnxruntime-node": false,
        // Transformers env.js: isEmpty(fs/path) → Object.keys; undefined면 즉시 크래시
        fs: emptyStub,
        path: emptyStub,
      };
    }
    return config;
  },
};

export default withPWA(nextConfig);
