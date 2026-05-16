'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Mail, X, Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Recipient = { email: string; name: string };

type MetaResponse = {
  defaultRecipients: Recipient[];
  unresolvedOwnerCount: number;
  defaultSubject: string;
  meetingStatus: string;
  quota: {
    allowed: boolean;
    reason: 'org_limit' | 'platform_limit' | null;
    orgUsed: number;
    orgLimit: number;
    platformUsed: number;
    platformLimit: number;
  };
};

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'success'; count: number }
  | { kind: 'error'; message: string };

export default function SendEmailModal({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [appendedMessage, setAppendedMessage] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [previewBust, setPreviewBust] = useState(0);

  // Debounce preview reload when user types appendedMessage
  const msgTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    if (msgTimerRef.current) window.clearTimeout(msgTimerRef.current);
    msgTimerRef.current = window.setTimeout(() => setPreviewBust((n) => n + 1), 500);
    return () => {
      if (msgTimerRef.current) window.clearTimeout(msgTimerRef.current);
    };
  }, [appendedMessage, open]);

  // Open: load meta
  useEffect(() => {
    if (!open) return;
    setStatus({ kind: 'idle' });
    setLoadingMeta(true);
    fetch(`/api/meetings/${meetingId}/email-recipients`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as MetaResponse;
      })
      .then((m) => {
        setMeta(m);
        setRecipients(m.defaultRecipients);
        setSubject(m.defaultSubject);
      })
      .catch((e) => {
        setStatus({ kind: 'error', message: `載入失敗：${e instanceof Error ? e.message : String(e)}` });
      })
      .finally(() => setLoadingMeta(false));
  }, [open, meetingId]);

  const previewUrl = useMemo(() => {
    const u = new URL(`/api/meetings/${meetingId}/email-preview`, window.location.origin);
    if (appendedMessage.trim()) u.searchParams.set('msg', appendedMessage);
    u.searchParams.set('_t', String(previewBust));
    return u.pathname + '?' + u.searchParams.toString();
  }, [meetingId, appendedMessage, previewBust]);

  function removeRecipient(email: string) {
    setRecipients((rs) => rs.filter((r) => r.email !== email));
  }

  function addRecipientFromInput() {
    const v = newEmail.trim();
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setStatus({ kind: 'error', message: '無效的 email 格式' });
      return;
    }
    if (recipients.some((r) => r.email.toLowerCase() === v.toLowerCase())) {
      setStatus({ kind: 'error', message: '此 email 已在收件人清單' });
      return;
    }
    setRecipients((rs) => [...rs, { email: v, name: v }]);
    setNewEmail('');
    setStatus({ kind: 'idle' });
  }

  async function send() {
    if (recipients.length === 0) {
      setStatus({ kind: 'error', message: '請至少加一位收件人' });
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      const res = await fetch(`/api/meetings/${meetingId}/send-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recipients: recipients.map((r) => r.email),
          subject,
          appendedMessage: appendedMessage.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({
          kind: 'error',
          message: body?.message ?? body?.error ?? `寄送失敗（${res.status}）`,
        });
        return;
      }
      setStatus({ kind: 'success', count: body.recipientCount ?? recipients.length });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const quotaBlocked = meta && !meta.quota.allowed;
  const buttonTooltip = quotaBlocked
    ? meta!.quota.reason === 'org_limit'
      ? `本月寄信額度已用完（${meta!.quota.orgUsed}/${meta!.quota.orgLimit}），下個月 1 號重置`
      : `平台本月寄信額度已用完，請聯絡管理員`
    : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
      >
        <Mail className="h-4 w-4" />
        寄出會議紀錄
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && status.kind !== 'sending') setOpen(false);
          }}
        >
          <div className="flex h-[min(90vh,820px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold text-slate-900">寄送會議紀錄</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={status.kind === 'sending'}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                aria-label="關閉"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {/* Left: form */}
              <div className="space-y-4 overflow-y-auto border-r p-5">
                {loadingMeta ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> 載入中...
                  </div>
                ) : meta ? (
                  <>
                    {meta.unresolvedOwnerCount > 0 ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        ⚠ 有 {meta.unresolvedOwnerCount} 條行動項目尚未分派到成員，
                        會在 email 內另外標示但不影響寄出。
                      </div>
                    ) : null}

                    {/* Quota bar */}
                    <QuotaBar meta={meta.quota} />

                    {/* Recipients */}
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        收件人（{recipients.length}）
                      </label>
                      <div className="flex flex-wrap gap-2 rounded-md border border-slate-300 bg-white p-2">
                        {recipients.map((r) => (
                          <span
                            key={r.email}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs"
                          >
                            <span className="font-medium text-slate-700">{r.name}</span>
                            <span className="text-slate-500">&lt;{r.email}&gt;</span>
                            <button
                              type="button"
                              onClick={() => removeRecipient(r.email)}
                              className="ml-1 rounded-full p-0.5 hover:bg-slate-200"
                              aria-label="移除"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        <div className="flex items-center gap-1">
                          <input
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addRecipientFromInput();
                              }
                            }}
                            placeholder="+ 加收件人 email"
                            className="min-w-[180px] flex-1 rounded border-0 px-1 py-1 text-xs outline-none focus:ring-2 focus:ring-slate-300"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Subject */}
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">主旨</label>
                      <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                      />
                    </div>

                    {/* Appended message */}
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        附加訊息（可選）
                      </label>
                      <textarea
                        value={appendedMessage}
                        onChange={(e) => setAppendedMessage(e.target.value)}
                        rows={4}
                        placeholder="例如：請各位確認下方行動項目的截止日"
                        className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>

                    {/* Status */}
                    {status.kind === 'error' ? (
                      <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        {status.message}
                      </div>
                    ) : null}
                    {status.kind === 'success' ? (
                      <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                        ✓ 已寄給 {status.count} 位收件人
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>

              {/* Right: preview */}
              <div className="overflow-hidden bg-slate-100">
                <div className="border-b border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-500">
                  預覽
                </div>
                <iframe
                  key={previewUrl}
                  src={previewUrl}
                  title="Email 預覽"
                  className="h-full w-full border-0 bg-white"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t bg-slate-50 px-5 py-3">
              <div className="text-xs text-slate-500">
                {quotaBlocked ? <span title={buttonTooltip}>{buttonTooltip}</span> : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={status.kind === 'sending'}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={status.kind === 'sending' || loadingMeta || !!quotaBlocked}
                  title={buttonTooltip}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium text-white transition',
                    quotaBlocked
                      ? 'cursor-not-allowed bg-slate-300'
                      : 'bg-slate-900 hover:bg-slate-800',
                  )}
                >
                  {status.kind === 'sending' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {status.kind === 'sending' ? '寄送中…' : '寄出'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function QuotaBar({
  meta,
}: {
  meta: MetaResponse['quota'];
}) {
  const orgPct = Math.min(100, Math.round((meta.orgUsed / Math.max(1, meta.orgLimit)) * 100));
  const platPct = Math.min(100, Math.round((meta.platformUsed / Math.max(1, meta.platformLimit)) * 100));
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-medium">本月寄信額度</span>
        <span className="tabular-nums text-slate-500">
          Org {meta.orgUsed}/{meta.orgLimit} · 平台 {meta.platformUsed}/{meta.platformLimit}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn(
            'h-full',
            orgPct >= 100 ? 'bg-rose-500' : orgPct >= 80 ? 'bg-orange-500' : 'bg-emerald-500',
          )}
          style={{ width: `${orgPct}%` }}
        />
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn(
            'h-full',
            platPct >= 100 ? 'bg-rose-500' : platPct >= 80 ? 'bg-orange-500' : 'bg-slate-400',
          )}
          style={{ width: `${platPct}%` }}
        />
      </div>
    </div>
  );
}
