/**
 * SVG → PNG 아이콘 생성 스크립트
 * sharp 패키지가 없으면 SVG만 생성합니다.
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

mkdirSync(join(publicDir, "icons"), { recursive: true });

// FocusAI 로고 SVG
function makeSvg(size) {
  const pad = Math.round(size * 0.12);
  const inner = size - pad * 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = inner / 2;
  const innerR = r * 0.42;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#0a0a0a"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="#0a0a0a"/>
</svg>`;
}

const sizes = [192, 512];

for (const size of sizes) {
  const svg = makeSvg(size);
  const svgPath = join(publicDir, "icons", `icon-${size}x${size}.svg`);
  writeFileSync(svgPath, svg, "utf8");
  console.log(`생성: ${svgPath}`);
}

// Apple touch icon (180x180)
const appleIcon = makeSvg(180);
writeFileSync(join(publicDir, "apple-touch-icon.svg"), appleIcon, "utf8");
console.log("생성: apple-touch-icon.svg");

console.log("아이콘 생성 완료!");
