"use client";

import { useCallback, useRef, useState } from "react";

interface UploadZoneProps {
  onImageLoad: (img: HTMLImageElement, file: File) => void | Promise<void>;
}

export default function UploadZone({ onImageLoad }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        Promise.resolve(onImageLoad(img, file)).finally(() => {
          URL.revokeObjectURL(url);
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [onImageLoad]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // 같은 파일 재업로드를 허용하기 위해 input 값 초기화
    e.target.value = "";
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  return (
    // 바깥: 드롭 히트 영역(캔버스 전체). PC에서는 안이 카드로 줄어들어도 어디에 놓든 인식.
    <div
      className="relative flex h-full w-full cursor-pointer items-center justify-center"
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 안: 실제로 보이는 카드. 모바일은 캔버스를 꽉 채우고, PC는 가운데 정렬된 적당한 크기 */}
      <div
        className={`
          flex h-full w-full flex-col items-center justify-center
          rounded-2xl border-2 border-dashed transition-all duration-200
          lg:h-auto lg:w-auto lg:min-w-[24rem] lg:max-w-md lg:rounded-3xl lg:px-14 lg:py-16 lg:shadow-2xl lg:shadow-black/40
          ${
            isDragging
              ? "scale-[0.99] border-white bg-white/10"
              : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-500 hover:bg-zinc-900 lg:hover:border-zinc-400"
          }
        `}
      >
        {/* 업로드 아이콘 */}
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800 lg:h-20 lg:w-20 lg:bg-gradient-to-br lg:from-zinc-700 lg:to-zinc-900 lg:ring-1 lg:ring-white/[0.06]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-7 w-7 text-zinc-400 lg:h-9 lg:w-9"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
            />
          </svg>
        </div>

        <p className="mb-1 text-base font-medium text-white lg:text-lg">
          사진을 업로드하세요
        </p>
        <p className="text-center text-sm leading-relaxed text-zinc-500 lg:text-[15px]">
          클릭하거나 여기로 드래그하세요
        </p>
        <div className="mt-3 flex items-center gap-1.5 lg:mt-4">
          {["JPG", "PNG", "WEBP"].map((fmt) => (
            <span
              key={fmt}
              className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-600"
            >
              {fmt}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
