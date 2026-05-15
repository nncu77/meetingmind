import UploadForm from './UploadForm';

export default function NewMeetingPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">上傳新會議</h1>
        <p className="mt-1 text-sm text-slate-500">
          支援 mp3 / m4a / wav / webm / ogg。Free 方案上限 50 MB / 5 分鐘。
        </p>
      </header>

      <UploadForm />
    </main>
  );
}
