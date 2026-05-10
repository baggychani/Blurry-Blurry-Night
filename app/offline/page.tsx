export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main
      className="flex flex-col items-center justify-center bg-black text-white"
      style={{ height: "100dvh" }}
    >
      <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-6">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-8 h-8 text-zinc-400"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
      </div>
      <h1 className="text-xl font-semibold mb-2">오프라인 상태입니다</h1>
      <p className="text-zinc-500 text-sm text-center">
        인터넷 연결을 확인하고 다시 시도해 주세요.
        <br />
        AI 모델 로드에는 인터넷이 필요합니다.
      </p>
    </main>
  );
}
