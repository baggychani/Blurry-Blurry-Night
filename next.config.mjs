import path from "path";
import { fileURLToPath } from "url";
import withPWAInit from "@ducanh2912/next-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withPWA = withPWAInit({
  dest: "public",
  // 개발 환경에서는 서비스 워커 비활성화 (핫 리로드 간섭 방지)
  disable: process.env.NODE_ENV === "development",
  // 오프라인 폴백 페이지
  fallbacks: {
    document: "/offline",
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
