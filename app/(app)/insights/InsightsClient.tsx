'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, X } from 'lucide-react';
import InfluenceGraph, { type GraphData, type GraphNode } from './InfluenceGraph';

type Range = '7' | '30' | '90' | 'all';

type ApiNode = { id: string; name: string; hasVoice: boolean; taskCount: number };
type ApiLink = { source: string; target: string; weight: number; lastInteraction: string };
type ApiPerMember = Record<
  string,
  {
    assigns: { memberId: string; name: string; count: number }[];
    assigned: { memberId: string; name: string; count: number }[];
    recentMeetings: { id: string; title: string; date: string }[];
  }
>;

const RANGE_LABEL: Record<Range, string> = {
  '7': '近 7 天',
  '30': '近 30 天',
  '90': '近 90 天',
  all: '全部',
};

export default function InsightsClient() {
  const [range, setRange] = useState<Range>('30');
  const [onlyMe, setOnlyMe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawNodes, setRawNodes] = useState<ApiNode[]>([]);
  const [rawLinks, setRawLinks] = useState<ApiLink[]>([]);
  const [perMember, setPerMember] = useState<ApiPerMember>({});
  const [meId, setMeId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/insights/influence-graph?range=${range}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setRawNodes(d.nodes ?? []);
        setRawLinks(d.links ?? []);
        setPerMember(d.perMember ?? {});
        setMeId(d.me?.id ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const filtered = useMemo<GraphData>(() => {
    if (!onlyMe || !meId) {
      return { nodes: rawNodes, links: rawLinks };
    }
    // 只看與我有交互的節點 + 連線
    const relatedIds = new Set<string>([meId]);
    for (const l of rawLinks) {
      if (l.source === meId) relatedIds.add(l.target);
      if (l.target === meId) relatedIds.add(l.source);
    }
    return {
      nodes: rawNodes.filter((n) => relatedIds.has(n.id)),
      links: rawLinks.filter((l) => relatedIds.has(l.source) && relatedIds.has(l.target)),
    };
  }, [rawNodes, rawLinks, onlyMe, meId]);

  const selectedNode = selectedId ? filtered.nodes.find((n) => n.id === selectedId) : null;
  const selectedDetail = selectedId ? perMember[selectedId] : null;

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-700">
          時間範圍:
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            className="ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
              <option key={r} value={r}>
                {RANGE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={onlyMe}
            onChange={(e) => setOnlyMe(e.target.checked)}
            disabled={!meId}
            className="h-4 w-4 rounded border-slate-300"
          />
          只看我相關
        </label>
        <div className="flex-1" />
        <Legend />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Graph */}
        <div className="relative rounded-lg border bg-white shadow-sm" style={{ height: 600 }}>
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 載入中…
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-rose-700">
              載入失敗:{error}
            </div>
          ) : (
            <InfluenceGraph
              data={filtered}
              meId={meId}
              onSelectNode={setSelectedId}
              selectedId={selectedId}
            />
          )}
        </div>

        {/* Side panel */}
        <aside className="rounded-lg border bg-white p-4 shadow-sm">
          {selectedNode && selectedDetail ? (
            <NodeDetailPanel
              node={selectedNode}
              detail={selectedDetail}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="text-sm text-slate-500">
              <p className="mb-2 font-medium text-slate-700">說明</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>每個圓圈 = 一位成員</li>
                <li>連線 = 「A 在某場會議指派任務給 B」,粗細為次數</li>
                <li>節點大小 = 被指派任務總數</li>
                <li>金邊框 = 有聲紋註冊</li>
                <li>拖曳節點 / 滾輪縮放 / 拖背景平移</li>
                <li>點節點可看詳細</li>
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full bg-slate-400" />
        節點
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-amber-400 bg-slate-400" />
        有聲紋
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-0.5 w-6 bg-[#93c5fd]" />
        指派連線
      </span>
    </div>
  );
}

function NodeDetailPanel({
  node,
  detail,
  onClose,
}: {
  node: GraphNode;
  detail: ApiPerMember[string];
  onClose: () => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">{node.name}</p>
          <p className="text-xs text-slate-500">
            被指派 {node.taskCount} 次{node.hasVoice ? ' · 聲紋已註冊' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Section title="指派他人">
        {detail.assigns.length === 0 ? (
          <p className="text-xs text-slate-400">尚無資料</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {detail.assigns
              .sort((a, b) => b.count - a.count)
              .map((a) => (
                <li key={a.memberId} className="flex justify-between">
                  <span>{a.name}</span>
                  <span className="tabular-nums text-slate-500">{a.count}</span>
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section title="被指派">
        {detail.assigned.length === 0 ? (
          <p className="text-xs text-slate-400">尚無資料</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {detail.assigned
              .sort((a, b) => b.count - a.count)
              .map((a) => (
                <li key={a.memberId} className="flex justify-between">
                  <span>{a.name}</span>
                  <span className="tabular-nums text-slate-500">{a.count}</span>
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section title="最近 5 場相關會議">
        {detail.recentMeetings.length === 0 ? (
          <p className="text-xs text-slate-400">尚無資料</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {detail.recentMeetings.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/meetings/${m.id}`}
                  className="text-slate-700 hover:underline"
                >
                  {m.title}
                </Link>
                <span className="ml-2 text-slate-400">
                  {new Date(m.date).toLocaleDateString('zh-TW')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 border-t border-slate-100 pt-2 first-of-type:border-0 first-of-type:pt-0">
      <p className="mb-1 text-xs font-medium text-slate-700">{title}</p>
      {children}
    </div>
  );
}
