// Next.js 16 + Turbopack 的 /_not-found 預渲染會打到 workStore invariant，
// 自己提供一份 not-found 並標 dynamic 直接迴避。
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl font-semibold text-slate-900">404</h1>
      <p className="mt-2 text-sm text-slate-600">這個頁面不存在或已被移除。</p>
      <Link
        href="/meetings"
        className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
      >
        回會議列表
      </Link>
    </main>
  );
}
