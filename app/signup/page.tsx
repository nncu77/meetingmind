import Link from 'next/link';
import { signUpAction } from './actions';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; check_email?: string }>;
}) {
  const { error, check_email } = await searchParams;

  if (check_email) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-lg border bg-white p-8 text-center shadow-sm">
          <h1 className="mb-3 text-2xl font-semibold text-slate-900">查收你的信箱</h1>
          <p className="text-sm leading-relaxed text-slate-600">
            我們寄了一封驗證信給你。點擊裡面的連結就能完成註冊並登入。
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm font-medium text-slate-700 underline"
          >
            ← 回登入頁
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-slate-900">建立帳號</h1>
        <p className="mb-6 text-sm text-slate-500">註冊完馬上就能上傳會議錄音。</p>

        <form action={signUpAction} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="name">
              你的名字
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autoComplete="name"
              placeholder="例:王小明"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="password">
              密碼
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
            <p className="mt-1 text-xs text-slate-500">至少 8 個字元</p>
          </div>

          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            建立帳號
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          已經有帳號？{' '}
          <Link href="/login" className="font-medium text-slate-900 underline">
            登入
          </Link>
        </p>
      </div>
    </main>
  );
}
