'use client';

import { useEffect, useState } from 'react';
import { Share2, Copy, Check, X, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type ShareLink = {
  id: string;
  token: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  created_at: string;
};

type Duration = '7d' | '30d' | 'permanent';

type Quota = {
  allowed: boolean;
  reason: 'org_limit' | 'platform_limit' | null;
  orgUsed: number;
  orgLimit: number;
  platformUsed: number;
  platformLimit: number;
};

export default function ShareLinkModal({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [duration, setDuration] = useState<Duration>('7d');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);

  // Load links + quota each time modal opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    Promise.all([
      fetch(`/api/meetings/${meetingId}/share-links`).then((r) => r.json()),
      fetch(`/api/meetings/${meetingId}/share-link-quota`).then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([linksRes, quotaRes]) => {
        setLinks(linksRes.links ?? []);
        if (quotaRes?.quota) setQuota(quotaRes.quota);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, meetingId]);

  async function createLink() {
    if (duration === 'permanent') {
      const ok = window.confirm(
        '永久連結不會自動失效，任何拿到此連結的人都能無限期查看會議內容。確定建立嗎?',
      );
      if (!ok) return;
    }
    setError(null);
    setCreating(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/share-links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ duration }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? `建立失敗（${res.status}）`);
        return;
      }
      setLinks((prev) => [body.link, ...prev]);
      // refresh quota
      fetch(`/api/meetings/${meetingId}/share-link-quota`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.quota) setQuota(d.quota);
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(linkId: string) {
    if (!window.confirm('撤銷後此連結會立即失效，無法恢復。確定?')) return;
    try {
      const res = await fetch(
        `/api/meetings/${meetingId}/share-links/${linkId}/revoke`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? '撤銷失敗');
        return;
      }
      setLinks((prev) =>
        prev.map((l) =>
          l.id === linkId ? { ...l, revoked_at: new Date().toISOString() } : l,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 1500);
    });
  }

  const quotaBlocked = quota && !quota.allowed;
  const quotaTooltip = quotaBlocked
    ? quota!.reason === 'org_limit'
      ? `本月分享連結額度已用完（${quota!.orgUsed}/${quota!.orgLimit}），下個月 1 號重置`
      : `平台本月分享連結額度已用完`
    : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
      >
        <Share2 className="h-4 w-4" />
        分享
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !creating) setOpen(false);
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div className="flex items-center gap-2">
                <Share2 className="h-5 w-5 text-slate-700" />
                <h2 className="text-lg font-semibold text-slate-900">公開分享連結</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={creating}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                aria-label="關閉"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 px-5 py-4">
              <p className="text-xs text-slate-500">
                建立後任何拿到連結的人都能查看會議摘要與逐字稿（無需登入），但無法編輯。
              </p>

              {/* Quota status */}
              {quota ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span className="font-medium">本月分享連結額度</span>
                    <span className="tabular-nums text-slate-500">
                      Org {quota.orgUsed}/{quota.orgLimit}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={cn(
                        'h-full',
                        quota.orgUsed >= quota.orgLimit
                          ? 'bg-rose-500'
                          : quota.orgUsed >= quota.orgLimit * 0.8
                          ? 'bg-orange-500'
                          : 'bg-emerald-500',
                      )}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round((quota.orgUsed / Math.max(1, quota.orgLimit)) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {/* Create form */}
              <div className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 text-sm font-medium text-slate-700">建立新連結</div>
                <div className="mb-3 flex gap-2">
                  {(['7d', '30d', 'permanent'] as Duration[]).map((d) => (
                    <label
                      key={d}
                      className={cn(
                        'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition',
                        duration === d
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <input
                        type="radio"
                        name="duration"
                        value={d}
                        checked={duration === d}
                        onChange={() => setDuration(d)}
                        className="sr-only"
                      />
                      {d === '7d' ? '7 天' : d === '30d' ? '30 天' : '永久'}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={createLink}
                  disabled={creating || !!quotaBlocked}
                  title={quotaTooltip}
                  className={cn(
                    'inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition',
                    quotaBlocked
                      ? 'cursor-not-allowed bg-slate-300'
                      : 'bg-slate-900 hover:bg-slate-800',
                  )}
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {creating ? '建立中...' : '產生連結'}
                </button>
                {quotaTooltip ? (
                  <p className="mt-2 text-xs text-rose-600">{quotaTooltip}</p>
                ) : null}
              </div>

              {/* Error */}
              {error ? (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {/* Existing links */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-slate-700">
                  現存連結（{links.length}）
                </h3>
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> 載入中...
                  </div>
                ) : links.length === 0 ? (
                  <p className="text-xs text-slate-400">尚未建立任何連結</p>
                ) : (
                  <ul className="space-y-2">
                    {links.map((l) => (
                      <LinkRow
                        key={l.id}
                        link={l}
                        copied={copiedToken === l.token}
                        onCopy={() => copyLink(l.token)}
                        onRevoke={() => revoke(l.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function LinkRow({
  link,
  copied,
  onCopy,
  onRevoke,
}: {
  link: ShareLink;
  copied: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const revoked = !!link.revoked_at;
  const expired = link.expires_at != null && new Date(link.expires_at) <= new Date();
  const dead = revoked || expired;
  const statusLabel = revoked ? '已撤銷' : expired ? '已過期' : link.expires_at ? formatExpiry(link.expires_at) : '永久';
  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/share/${link.token}`
    : `/share/${link.token}`;

  return (
    <li className={cn('rounded-md border p-2 text-xs', dead ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200 bg-white')}>
      <div className="flex items-center gap-2">
        <code className={cn('flex-1 truncate font-mono text-[11px]', dead && 'line-through')}>
          {url}
        </code>
        {!dead ? (
          <button
            type="button"
            onClick={onCopy}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            title="複製"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        {!dead ? (
          <button
            type="button"
            onClick={onRevoke}
            className="rounded p-1 text-rose-500 hover:bg-rose-50"
            title="撤銷"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>{statusLabel}</span>
        <span>{link.view_count} 次瀏覽</span>
      </div>
    </li>
  );
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  return `${days} 天後到期`;
}
