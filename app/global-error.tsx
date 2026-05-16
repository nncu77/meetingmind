'use client';

// Next.js 16.2.6 內建 /_global-error 預渲染會碰到 workStore invariant，
// 自己提供一份 client-side error boundary 直接迴避。

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-Hant">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">發生錯誤</h1>
          <p className="mt-2 text-sm text-slate-600">頁面發生未預期錯誤，請稍後再試。</p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            重試
          </button>
        </div>
      </body>
    </html>
  );
}
