'use client';
import { Handle, Position } from 'reactflow';
import type { NodeKind } from '@/lib/types';

const PALETTE: Record<NodeKind, { label: string; bar: string; chip: string; ring: string }> = {
  dynamic: { label: 'Dynamic', bar: 'bg-sky-500', chip: 'bg-sky-500/15 text-sky-300 border-sky-500/40', ring: 'border-sky-500/40' },
  crud: { label: 'CRUD', bar: 'bg-emerald-500', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', ring: 'border-emerald-500/40' },
  derived: { label: 'Derived', bar: 'bg-violet-500', chip: 'bg-violet-500/15 text-violet-300 border-violet-500/40', ring: 'border-violet-500/40' },
  interceptor: { label: 'Interceptor', bar: 'bg-amber-500', chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40', ring: 'border-amber-500/40' },
};

export default function TableNode({ data }: { data: { kind: NodeKind; name: string; subtitle?: string } }) {
  const p = PALETTE[data.kind];
  return (
    <div className={`tb-node w-56 rounded-md border ${p.ring} bg-neutral-900 shadow-md overflow-hidden`}>
      <div className={`h-1 ${p.bar}`} />
      <div className="p-3">
        <div className={`inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${p.chip} mb-1.5`}>{p.label}</div>
        <div className="text-sm font-medium truncate">{data.name || '(unnamed)'}</div>
        {data.subtitle && <div className="text-xs text-neutral-400 mt-0.5 truncate">{data.subtitle}</div>}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
