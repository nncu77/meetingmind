import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function MembersPage() {
  const sb = await createSupabaseServerClient();
  const { data: members } = await sb
    .from('members')
    .select('id, name, email, role, voice_embedding, enrolled_at, created_at')
    .order('created_at', { ascending: true });

  const list = members ?? [];
  const enrolledCount = list.filter((m) => m.voice_embedding).length;

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-6">
      <header className="mb-6 flex items-baseline justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">組織成員</h1>
          <p className="mt-1 text-sm text-slate-500">
            {list.length} 位成員 · {enrolledCount} 位已註冊聲紋
          </p>
        </div>
      </header>

      <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">名字</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">角色</th>
              <th className="px-4 py-2 font-medium">聲紋狀態</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{m.name}</td>
                <td className="px-4 py-3 text-slate-600">{m.email ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">{m.role}</td>
                <td className="px-4 py-3">
                  {m.voice_embedding ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      ✓ 已註冊
                      {m.enrolled_at && (
                        <span className="ml-1 text-emerald-600">
                          {new Date(m.enrolled_at).toLocaleDateString('zh-TW')}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      未註冊
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/members/${m.id}/enroll`}
                    className="text-sm font-medium text-slate-700 hover:text-slate-900"
                  >
                    {m.voice_embedding ? '重錄聲紋' : '錄聲紋'} →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        註冊聲紋後，未來的會議錄音會自動把該成員的發言段落貼上正確的名字標籤
        （超過 0.82 cosine similarity 才標，避免錯認）。
      </p>
    </main>
  );
}
