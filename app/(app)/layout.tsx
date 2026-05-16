import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// (app) 之下所有頁都需要 cookies()/getUser()，永遠是 per-request。
// Next.js 16 的 static-detection 偶爾誤判 /meetings/new 等子頁可 prerender，
// 統一在這裡標 dynamic 避開 invariant error。
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: member } = await supabase
    .from('members')
    .select('id, name, email, org_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: org } = member
    ? await supabase.from('organizations').select('name, plan').eq('id', member.org_id).maybeSingle()
    : { data: null };

  const orgName = org?.name ?? '(未加入組織)';
  const displayName = member?.name ?? user.email ?? '使用者';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/meetings" className="text-lg font-semibold text-slate-900">
              MeetingMind
            </Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              <Link href="/meetings" className="hover:text-slate-900">
                會議
              </Link>
              <Link href="/members" className="hover:text-slate-900">
                成員
              </Link>
              <Link href="/eval" className="hover:text-slate-900">
                指標
              </Link>
              <Link href="/settings/usage" className="hover:text-slate-900">
                用量
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right leading-tight">
              <div className="font-medium text-slate-900">{displayName}</div>
              <div className="text-xs text-slate-500">{orgName}</div>
            </div>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
              >
                登出
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
