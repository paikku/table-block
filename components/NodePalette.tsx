'use client';
import type { NodeKind } from '@/lib/types';

const items: { kind: NodeKind; label: string; desc: string; color: string }[] = [
  { kind: 'dynamic', label: 'Dynamic', desc: '외부 fetch (API/DB/File)', color: 'bg-sky-500' },
  { kind: 'crud', label: 'CRUD', desc: '사용자 편집 상태', color: 'bg-emerald-500' },
  { kind: 'derived', label: 'Derived', desc: '룰 캐스케이드', color: 'bg-violet-500' },
  { kind: 'interceptor', label: 'Interceptor', desc: 'pass / block / filter', color: 'bg-amber-500' },
];

export default function NodePalette() {
  return (
    <div className="w-56 shrink-0 border-r border-neutral-800 bg-neutral-950 p-3 overflow-y-auto">
      <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Palette</div>
      <div className="text-[11px] text-neutral-500 mb-3">노드를 캔버스로 드래그하세요.</div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li
            key={it.kind}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-tableblock-kind', it.kind);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className="cursor-grab active:cursor-grabbing rounded border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 p-2"
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${it.color}`} />
              <span className="text-sm font-medium">{it.label}</span>
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5">{it.desc}</div>
          </li>
        ))}
      </ul>
      <div className="mt-6 text-[11px] text-neutral-500 leading-relaxed">
        <div className="text-neutral-400 mb-1">단축키</div>
        <ul className="space-y-0.5">
          <li>• 노드/엣지 선택 후 <kbd className="px-1 border border-neutral-700 rounded">Del</kbd> 로 삭제</li>
          <li>• 노드 우측 핸들 → 다른 노드 좌측 핸들로 드래그해 연결</li>
          <li>• 캔버스를 드래그하면 팬, 휠로 줌</li>
        </ul>
      </div>
    </div>
  );
}
