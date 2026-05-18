'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlowDoc, FlowEdge, FlowNode, NodeConfig } from '@/lib/types';
import type { RunResult, TableData } from '@/lib/runFlow';
import { NodeEditorBody } from './ConfigPanel';

interface Props {
  open: boolean;
  node: FlowNode | null;
  allNodes: FlowNode[];
  allEdges: FlowEdge[];
  onChange: (cfg: NodeConfig) => void;
  onClose: () => void;
  buildDoc: () => FlowDoc;
}

export default function LargeEditorModal({
  open,
  node,
  allNodes,
  allEdges,
  onChange,
  onClose,
  buildDoc,
}: Props) {
  const [preview, setPreview] = useState<{ result: RunResult; nodeId: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setErr(null);
      abortRef.current?.abort();
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const runPreview = useCallback(async () => {
    if (!node) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setErr(null);
    try {
      const doc = buildDoc();
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
        signal: ac.signal,
      });
      const j = (await r.json()) as RunResult;
      if (!ac.signal.aborted) setPreview({ result: j, nodeId: node.id });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [buildDoc, node]);

  // 자동 미리보기: 모달이 열려있는 동안 선택 노드의 config / 그래프 구조가 바뀔 때마다
  // 300ms 디바운스 후 /api/run 실행. 빠른 연속 편집은 묶임.
  const docSignature = useMemo(() => {
    if (!open || !node) return '';
    return JSON.stringify({
      nodes: allNodes.map((n) => ({ id: n.id, config: n.config })),
      edges: allEdges.map((e) => ({ s: e.source, t: e.target })),
      sel: node.id,
    });
  }, [open, node, allNodes, allEdges]);

  useEffect(() => {
    if (!open || !node) return;
    const t = setTimeout(() => {
      runPreview();
    }, 300);
    return () => clearTimeout(t);
  }, [docSignature, open, node, runPreview]);

  if (!open || !node) return null;

  const nodeTable: TableData | undefined = preview?.result.tables[node.id];
  const nodeLogs = preview?.result.logs.filter((l) => l.nodeId === node.id || l.nodeId === '*') ?? [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl h-[85vh] bg-neutral-950 border border-neutral-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 h-12 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">{node.config.kind}</span>
            <span className="text-sm text-neutral-300">
              id: <span className="font-mono text-neutral-400">{node.id}</span> · {node.config.name}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-[11px] flex items-center gap-1 ${loading ? 'text-amber-300' : 'text-neutral-500'}`}
              title="설정이 바뀔 때마다 자동으로 미리보기를 갱신합니다 (300ms 디바운스)"
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  loading ? 'bg-amber-300 animate-pulse' : 'bg-emerald-400'
                }`}
              />
              {loading ? '자동 미리보기 중…' : '자동 미리보기 ON'}
            </span>
            <button
              onClick={runPreview}
              disabled={loading}
              className="px-2 py-0.5 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-50 text-[11px] text-neutral-300"
              title="지금 즉시 다시 실행"
            >
              ↻ 새로고침
            </button>
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200 text-sm">✕ 닫기</button>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-2 min-h-0">
          <div className="overflow-y-auto p-4 border-r border-neutral-800">
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-3">편집</div>
            <NodeEditorBody
              node={node}
              allNodes={allNodes}
              allEdges={allEdges}
              onChange={onChange}
              wide
            />
          </div>

          <div className="overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] uppercase tracking-wider text-neutral-500">미리보기</div>
              {nodeTable && (
                <div className="text-[11px] text-neutral-500">
                  {nodeTable.rows.length} rows · {nodeTable.schema.length} cols
                  {nodeTable.blocked && <span className="ml-2 text-red-400">blocked</span>}
                </div>
              )}
            </div>

            {err && <div className="text-xs text-red-400 mb-2">error: {err}</div>}
            {!preview && loading && (
              <div className="text-sm text-neutral-500">미리보기 실행 중…</div>
            )}

            {nodeLogs.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">logs</div>
                <ul className="space-y-0.5 font-mono text-[11px]">
                  {nodeLogs.map((l, i) => (
                    <li
                      key={i}
                      className={
                        l.level === 'error'
                          ? 'text-red-400'
                          : l.level === 'warn'
                          ? 'text-amber-300'
                          : 'text-neutral-300'
                      }
                    >
                      <span className="text-neutral-500">[{l.level}]</span> {l.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {nodeTable && nodeTable.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="text-[11px] font-mono border border-neutral-800">
                  <thead className="bg-neutral-900 sticky top-0">
                    <tr>
                      {nodeTable.schema.map((c) => (
                        <th
                          key={c.name}
                          className="px-2 py-1 border-r border-neutral-800 text-left text-neutral-400 whitespace-nowrap"
                        >
                          {c.name} <span className="text-neutral-600">:{c.type}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {nodeTable.rows.slice(0, 200).map((row, i) => (
                      <tr key={i} className="border-t border-neutral-800">
                        {nodeTable.schema.map((c) => (
                          <td
                            key={c.name}
                            className="px-2 py-1 border-r border-neutral-800 text-neutral-300 whitespace-nowrap"
                          >
                            {JSON.stringify(row[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {nodeTable.rows.length > 200 && (
                  <div className="text-[10px] text-neutral-500 mt-1">… {nodeTable.rows.length - 200} more rows</div>
                )}
              </div>
            )}

            {nodeTable && nodeTable.rows.length === 0 && !err && (
              <div className="text-xs text-neutral-500 mt-2">(0 rows)</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
