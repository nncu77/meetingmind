import InsightsClient from './InsightsClient';

export const dynamic = 'force-dynamic';

export default function InsightsPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <header className="mb-4 border-b pb-3">
        <h1 className="text-2xl font-semibold text-slate-900">會議影響圈</h1>
        <p className="mt-1 text-sm text-slate-500">誰跟誰一起推動工作</p>
      </header>
      <InsightsClient />
    </main>
  );
}
