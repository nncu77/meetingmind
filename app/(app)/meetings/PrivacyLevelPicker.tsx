'use client';

import { useEffect, useState } from 'react';
import { Lock, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PrivacyLevel = 'standard' | 'strict';

// 嚴格模式暫停 — 等 Together AI 預算到位 + 確認 zh-TW 模型穩定再開
// 翻成 true 即可恢復；同步見 app/api/upload/route.ts 的 server-side 防線
const STRICT_AVAILABLE = false;

type QuotaState = {
  allowed: boolean;
  reason: 'org_limit' | 'platform_limit' | null;
  orgUsed: number;
  orgLimit: number;
};

export default function PrivacyLevelPicker({
  value,
  onChange,
  disabled,
}: {
  value: PrivacyLevel;
  onChange: (v: PrivacyLevel) => void;
  disabled?: boolean;
}) {
  const [quota, setQuota] = useState<QuotaState | null>(null);

  useEffect(() => {
    if (!STRICT_AVAILABLE) return;
    fetch('/api/quota/strict_meeting')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.quota) setQuota(d.quota);
      })
      .catch(() => {});
  }, []);

  const strictBlocked = quota != null && !quota.allowed;
  const strictDisabledForUser = !STRICT_AVAILABLE || strictBlocked;
  const strictTooltip = !STRICT_AVAILABLE
    ? '嚴格隱私模式籌備中（等 zh-TW 適配模型 + Together AI 預算），預計後續開放'
    : strictBlocked
      ? quota!.reason === 'org_limit'
        ? `本月嚴格模式額度已用完（${quota!.orgUsed}/${quota!.orgLimit}），下個月 1 號重置`
        : '平台本月嚴格模式額度已用完'
      : undefined;

  // 任何時候 value === 'strict' 但目前不可用 → 退回 standard
  useEffect(() => {
    if (strictDisabledForUser && value === 'strict') onChange('standard');
  }, [strictDisabledForUser, value, onChange]);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">隱私層級</label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Option
          checked={value === 'standard'}
          onClick={() => onChange('standard')}
          disabled={disabled}
          accent="slate"
          icon={<Shield className="h-4 w-4" />}
          title="標準"
          subtitle="Claude（推薦）"
          desc="一般會議都用這個。Anthropic Sonnet 4.5 via OpenRouter。"
        />
        <Option
          checked={value === 'strict'}
          onClick={() => onChange('strict')}
          disabled={disabled || strictDisabledForUser}
          accent="violet"
          icon={<Lock className="h-4 w-4" />}
          title="嚴格"
          subtitle={STRICT_AVAILABLE ? 'Llama 70B' : '即將推出'}
          desc={
            STRICT_AVAILABLE
              ? '人事 / 法律 / 財務敏感會議。走 Together AI 自架 Llama 3.3 70B。'
              : '敏感會議專屬路線。Together AI 預算 + zh-TW 適配模型籌備中，後續開放。'
          }
          tooltip={strictTooltip}
        />
      </div>
      {STRICT_AVAILABLE && quota ? (
        <p className="mt-1 text-xs text-slate-500">
          嚴格模式本月用量：{quota.orgUsed} / {quota.orgLimit}
          {strictBlocked ? (
            <span className="ml-2 text-rose-600">已用完，下個月 1 號重置</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function Option({
  checked,
  onClick,
  disabled,
  accent,
  icon,
  title,
  subtitle,
  desc,
  tooltip,
}: {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
  accent: 'slate' | 'violet';
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  desc: string;
  tooltip?: string;
}) {
  const isViolet = accent === 'violet';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        'flex flex-col items-start gap-1 rounded-md border-2 p-3 text-left transition',
        checked
          ? isViolet
            ? 'border-violet-500 bg-violet-50'
            : 'border-slate-900 bg-slate-50'
          : 'border-slate-200 bg-white hover:border-slate-300',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-sm font-medium">{title}</span>
          <span className={cn('text-xs', isViolet ? 'text-violet-600' : 'text-slate-500')}>
            · {subtitle}
          </span>
        </div>
        {checked ? (
          <span
            className={cn(
              'h-3 w-3 rounded-full',
              isViolet ? 'bg-violet-500' : 'bg-slate-900',
            )}
          />
        ) : null}
      </div>
      <p className="text-xs leading-relaxed text-slate-600">{desc}</p>
    </button>
  );
}
