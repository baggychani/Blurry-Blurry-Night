# Blurry Blurry Night

AI 깊이 추정(Depth Estimation)으로 사진의 거리 맵을 만들고, WebGL 렌즈 블러로 아웃포커싱을 적용하는 **브라우저 전용** 웹앱입니다.  
이미지와 AI 추론은 모두 클라이언트에서 처리되어 서버 비용과 원본 사진 유출 위험을 줄입니다.

Made by **Baggychani**.

---

## 요구 사항

- **Node.js** 20.9 이상 (LTS 권장)
- **브라우저**: 최신 Chrome / Edge / Firefox / **Samsung Internet** / **iOS Safari** (WebGL · Web Worker · Pointer Events 필요)
- 모바일: `viewport-fit=cover`, 안전 영역(safe-area), 터치 타깃(초점 슬라이더 등)은 갤럭시·아이폰 모두를 염두에 두고 구성했습니다. 실제 기기에서 한 번씩 확인하는 것을 권장합니다.

---

## 시작하기

### 패키지 설치

```bash
git clone https://github.com/baggychani/Blurry-Blurry-Night.git
cd Blurry-Blurry-Night
npm install
```

### 개발 서버

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 엽니다.

### Windows에서 바로 실행

저장소 루트의 `Blurry Blurry Night 실행.bat`을 더블클릭하면 개발 서버 기동 후 브라우저를 열 수 있습니다.

### 정적 빌드 (산출물 `out/`)

Next.js를 **`output: 'export'`** 로 두어 HTML/CSS/JS만 생성합니다. `npm run start`(Node 서버)는 사용하지 않습니다.

```bash
npm run build
# 미리보기(선택): npx serve@14 out
```

---

## GitHub Pages 배포

1. 저장소 **Settings → Pages → Build and deployment**
2. **Source**를 **GitHub Actions**로 변경
3. `main` 또는 `master`에 푸시하면 `.github/workflows/deploy-github-pages.yml`이 빌드 후 `out/`을 배포합니다.

**주소가 `https://<사용자>.github.io/<저장소이름>/` 인 경우**  
워크플로의 `NEXT_BASE_PATH: /Blurry-Blurry-Night`를 **실제 저장소 이름과 동일**하게 두세요.  
`https://<사용자>.github.io/` **루트만** 쓰는 저장소(`username.github.io` 레포)라면 해당 env 줄을 **삭제**하고, 로컬 `next.config.mjs`의 `basePath`도 비우고 빌드하도록 워크플로를 맞추면 됩니다.

로컬에서 Pages와 동일하게 보려면:

```bash
# PowerShell 예시
$env:NEXT_BASE_PATH="/Blurry-Blurry-Night"; npm run build
npx serve@14 out
```

---

## 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev` | 개발 서버 |
| `npm run build` | 정적 내보내기 → `out/` |
| `npm run start` | (정적 배포에서는 미사용) |
| `npm run lint` | ESLint |
| `npm run type-check` | TypeScript 검사 |

---

## 기술 스택

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS** — 다크 UI
- **Framer Motion** — 하단 시트
- **Transformers.js** (`@xenova/transformers`) — Depth Anything 계열 모델, Web Worker에서 추론
- **WebGL** — 깊이 기반 보케·초점 범위
- **PWA** (`@ducanh2912/next-pwa`) — 설치·오프라인 폴백(개발 모드에서는 SW 비활성화)

---

## 프로젝트 구조 (요약)

```
app/
  page.tsx          # 메인 화면
  layout.tsx        # 메타·viewport·PWA 관련
components/
  Header.tsx
  UploadZone.tsx
  BottomSheet.tsx
  CompareSlider.tsx
  FocusRangeSlider.tsx
hooks/
  useDepth.ts
  useSegmenter.ts   # 레거시(MediaPipe), 현재 파이프라인 미사용
lib/
  depthWorker.ts
  depthWorkerInit.ts
  webglComposite.ts
  canvasComposite.ts  # 레거시 Canvas 합성(보존)
  empty-node-stub.js  # 브라우저 번들용 Node 스텁
scripts/
  generate-icons.mjs
```

---

## Git

- `.gitignore`: `node_modules`, `.next`, 환경 변수, OS 파일, PWA 빌드 산출물(`public/sw.js` 등) 제외
- `.gitattributes`: 텍스트 `eol=lf`, `*.bat`은 `crlf`

최초 원격 등록 후:

```bash
git add -A
git commit -m "Initial commit: Blurry Blurry Night"
git push -u origin master
```

원격 기본 브랜치가 `main`이면 `git branch -M main` 후 `git push -u origin main`을 사용하세요.

---

## 라이선스

개인 프로젝트입니다. 필요 시 저장소에 별도 LICENSE 파일을 추가하세요.
