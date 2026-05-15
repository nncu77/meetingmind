import RecordForm from './RecordForm';

export default function RecordPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">現場直錄</h1>
        <p className="mt-1 text-sm text-slate-500">
          筆電帶到會議室、按開始錄音、結束自動轉文字。建議外接全向麥克風或靠近講者放筆電。
        </p>
      </header>

      <RecordForm />
    </main>
  );
}
