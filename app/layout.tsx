import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Blurry Blurry Night",
  description: "AI로 사진 배경을 블러 처리하는 무료 웹앱. 모든 연산은 브라우저에서.",
  // PWA 관련 메타
  applicationName: "Blurry Blurry Night",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Blurry Blurry Night",
  },
  formatDetection: {
    telephone: false,
  },
  // Open Graph (공유 시 미리보기)
  openGraph: {
    type: "website",
    title: "Blurry Blurry Night",
    description: "AI로 사진 배경을 블러 처리하는 무료 웹앱",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0a",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* iOS PWA 아이콘 */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.svg" />
        {/* iOS 전체화면 모드 */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Microsoft 타일 */}
        <meta name="msapplication-TileColor" content="#0a0a0a" />
        <meta name="msapplication-tap-highlight" content="no" />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
