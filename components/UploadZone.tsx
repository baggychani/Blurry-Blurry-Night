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
    <div
      className={`
        relative flex flex-col items-center justify-center w-full h-full
        border-2 border-dashed rounded-2xl cursor-pointer
        transition-all duration-200
        ${
          isDragging
            ? "border-white bg-white/10 scale-[0.99]"
            : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-500 hover:bg-zinc-900"
        }
      `}
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

      {/* 업로드 아이콘 */}
      <div className="mb-5 w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-7 h-7 text-zinc-400"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
          />
        </svg>
      </div>

      <p className="text-white font-medium text-base mb-1">사진을 업로드하세요</p>
      <p className="text-zinc-500 text-sm text-center leading-relaxed">
        클릭하거나 여기로 드래그하세요
        <br />
        <span className="text-zinc-600 text-xs">JPG, PNG, WEBP 지원</span>
      </p>
    </div>
  );
}
