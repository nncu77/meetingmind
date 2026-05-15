import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import EnrollForm from './EnrollForm';

export default async function EnrollPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const { data: member } = await sb
    .from('members')
    .select('id, name, email, voice_embedding')
    .eq('id', id)
    .maybeSingle();
  if (!member) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">註冊聲紋：{member.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {member.voice_embedding ? '重新錄製會覆寫現有聲紋。' : ''}
          請戴耳機、在安靜的環境下，照下面三段文本依序朗讀。
        </p>
      </header>

      <EnrollForm memberId={member.id} memberName={member.name} />
    </main>
  );
}
