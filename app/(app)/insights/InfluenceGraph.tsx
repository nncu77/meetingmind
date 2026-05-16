'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
// 按 spec：個別 import，不用 import * as d3
import { select } from 'd3-selection';
import { drag, type D3DragEvent } from 'd3-drag';
import { zoom, type D3ZoomEvent } from 'd3-zoom';
import { scaleSqrt } from 'd3-scale';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GraphNode = {
  id: string;
  name: string;
  hasVoice: boolean;
  taskCount: number;
};

export type GraphLink = {
  source: string;
  target: string;
  weight: number;
  lastInteraction: string;
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

// ---------------------------------------------------------------------------
// D3 internal types — extend node/link with x/y/fx/fy that d3-force adds
// ---------------------------------------------------------------------------

type SimNode = SimulationNodeDatum & GraphNode;
type SimLink = SimulationLinkDatum<SimNode> & {
  source: SimNode | string;
  target: SimNode | string;
  weight: number;
  lastInteraction: string;
};

// ---------------------------------------------------------------------------
// Empty state thresholds（spec：少於 3 節點或 5 邊）
// ---------------------------------------------------------------------------

const MIN_NODES = 3;
const MIN_LINKS = 5;

const LINK_COLOR = '#93c5fd';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InfluenceGraph({
  data,
  meId,
  onSelectNode,
  selectedId,
}: {
  data: GraphData;
  meId?: string | null;
  onSelectNode: (id: string | null) => void;
  selectedId?: string | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);

  // Watch container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });
    return () => ro.disconnect();
  }, []);

  const empty =
    !data || data.nodes.length < MIN_NODES || data.links.length < MIN_LINKS;

  // ----- D3 setup（spec：useEffect 依賴只放 [data, dimensions]）-----
  useEffect(() => {
    if (empty) return;
    const svg = svgRef.current;
    if (!svg) return;
    const { width, height } = dimensions;
    if (width === 0 || height === 0) return;

    // Clone data — d3-force mutates objects in place
    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = data.links.map((l) => ({ ...l }));

    // Node size scale: sqrt of taskCount，最小 8 最大 24
    const maxTask = Math.max(1, ...nodes.map((n) => n.taskCount));
    const radiusScale = scaleSqrt().domain([0, maxTask]).range([8, 24]);

    const svgSel = select(svg);
    // 清掉前次的 g（switching data 時必要）
    svgSel.selectAll('g.graph-root').remove();

    const root = svgSel.append('g').attr('class', 'graph-root');

    // 連線 group（在節點下方，免得覆蓋）
    const linkSel = root
      .append('g')
      .attr('stroke', LINK_COLOR)
      .attr('stroke-opacity', 0.7)
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke-width', (l) => Math.log2(l.weight + 1) * 2);

    // 節點 group
    const nodeSel = root
      .append('g')
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(nodes, (n) => n.id)
      .enter()
      .append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer');

    nodeSel
      .append('circle')
      .attr('r', (n) => radiusScale(n.taskCount))
      .attr('fill', '#475569') // slate-600
      .attr('stroke', (n) => (n.hasVoice ? '#f59e0b' : '#1e293b'))
      .attr('stroke-width', (n) => (n.hasVoice ? 3 : 1.5));

    nodeSel
      .append('text')
      .attr('class', 'node-label')
      .attr('dy', (n) => -radiusScale(n.taskCount) - 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', '#1e293b')
      .attr('pointer-events', 'none')
      .text((n) => n.name);

    // Tooltip <title> for native hover
    linkSel.append('title').text((l) => {
      const src = typeof l.source === 'string' ? l.source : l.source.id;
      const tgt = typeof l.target === 'string' ? l.target : l.target.id;
      const srcName = nodes.find((n) => n.id === src)?.name ?? src;
      const tgtName = nodes.find((n) => n.id === tgt)?.name ?? tgt;
      return `${srcName} → ${tgtName}：${l.weight} 次指派`;
    });

    // Click handler — 走 React state，不 mutate DOM
    nodeSel.on('click', function (_event: MouseEvent, n: SimNode) {
      onSelectNode(n.id);
    });

    // Drag
    const dragBehavior = drag<SVGGElement, SimNode>()
      .on('start', (event: D3DragEvent<SVGGElement, SimNode, SimNode>, n) => {
        if (!event.active) simRef.current?.alphaTarget(0.3).restart();
        n.fx = n.x;
        n.fy = n.y;
      })
      .on('drag', (event, n) => {
        n.fx = event.x;
        n.fy = event.y;
      })
      .on('end', (event, n) => {
        if (!event.active) simRef.current?.alphaTarget(0);
        n.fx = null;
        n.fy = null;
      });
    nodeSel.call(dragBehavior);

    // Zoom + Pan on the SVG, applies transform to root <g>
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        root.attr('transform', event.transform.toString());
      });
    svgSel.call(zoomBehavior as any);

    // Simulation — tick mutates DOM directly per spec rule
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((n) => n.id)
          .distance((l) => 60 + 10 / Math.log2(l.weight + 2)),
      )
      .force('charge', forceManyBody().strength(-200))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>().radius((n) => radiusScale(n.taskCount) + 4))
      .on('tick', () => {
        linkSel
          .attr('x1', (l) => (l.source as SimNode).x ?? 0)
          .attr('y1', (l) => (l.source as SimNode).y ?? 0)
          .attr('x2', (l) => (l.target as SimNode).x ?? 0)
          .attr('y2', (l) => (l.target as SimNode).y ?? 0);
        nodeSel.attr('transform', (n) => `translate(${n.x ?? 0}, ${n.y ?? 0})`);
      });

    simRef.current = sim;

    return () => {
      sim.stop();
      simRef.current = null;
      svgSel.selectAll('g.graph-root').remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dimensions.width, dimensions.height]);

  // 選中變化時用直接 DOM 操作改節點外觀（不 re-run simulation）
  useEffect(() => {
    if (empty || !svgRef.current) return;
    const svg = select(svgRef.current);
    svg.selectAll<SVGCircleElement, SimNode>('g.node circle')
      .attr('stroke-width', (n) => {
        if (selectedId === n.id) return 4;
        return n.hasVoice ? 3 : 1.5;
      })
      .attr('stroke', (n) => {
        if (selectedId === n.id) return '#0f172a';
        return n.hasVoice ? '#f59e0b' : '#1e293b';
      });
  }, [selectedId, empty]);

  // 標出「我」
  const meHighlight = useMemo(() => meId ?? null, [meId]);
  useEffect(() => {
    if (empty || !svgRef.current || !meHighlight) return;
    const svg = select(svgRef.current);
    svg.selectAll<SVGTextElement, SimNode>('g.node text')
      .attr('font-weight', (n) => (n.id === meHighlight ? 700 : 400))
      .attr('fill', (n) => (n.id === meHighlight ? '#7c3aed' : '#1e293b'));
  }, [meHighlight, empty, data]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {empty ? <EmptyState nodes={data.nodes.length} links={data.links.length} /> : null}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: empty ? 'none' : 'block' }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state（spec：少於 3 節點或 5 邊 → 顯示示意圖）
// ---------------------------------------------------------------------------

function EmptyState({ nodes, links }: { nodes: number; links: number }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
      <svg viewBox="0 0 200 120" className="mb-4 h-32 w-48 opacity-70">
        <line x1="40" y1="40" x2="100" y2="60" stroke={LINK_COLOR} strokeWidth="2" />
        <line x1="100" y1="60" x2="160" y2="40" stroke={LINK_COLOR} strokeWidth="2" />
        <line x1="100" y1="60" x2="100" y2="100" stroke={LINK_COLOR} strokeWidth="2" />
        <circle cx="40" cy="40" r="12" fill="#475569" />
        <circle cx="100" cy="60" r="14" fill="#475569" />
        <circle cx="160" cy="40" r="10" fill="#475569" />
        <circle cx="100" cy="100" r="11" fill="#475569" />
      </svg>
      <p className="text-base font-medium text-slate-700">資料還不夠</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500">
        目前有 {nodes} 位成員、{links} 條連線。再開幾場會議,有人指派任務給其他人之後就會看到關係圖。
      </p>
    </div>
  );
}
