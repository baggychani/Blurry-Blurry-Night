import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Next.js 권장 규칙 + Prettier 충돌 규칙 비활성화
  ...compat.extends("next/core-web-vitals"),
  ...compat.extends("prettier"),
  {
    rules: {
      // _ 접두사 변수는 unused 경고 제외
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // any 타입은 경고만
      "@typescript-eslint/no-explicit-any": "warn",
      // React hook 의존성 배열 경고
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default eslintConfig;
