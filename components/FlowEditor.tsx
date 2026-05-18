'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from 'reactflow';
import type {
  Node as RFNode,
  Edge as RFEdge,
  Connection,
  NodeChange,
  EdgeChange,
  OnConnect,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import NodePalette from './NodePalette';
import ConfigPanel from './ConfigPanel';
import TableNode from './TableNode';
import type { FlowDoc, FlowNode, NodeConfig, NodeKind } from '@/lib/types';
import { defaultConfig } from '@/lib/types';
import type { RunResult } from '@/lib/runFlow';

const nodeTypes = { tb: TableNode };
const VALID_KINDS: NodeKind[] = ['dynamic', 'crud', 'derived', 'interceptor'];

function toRfNodes(nodes: FlowNode[]): RFNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: 'tb',
    position: n.position,
    data: { kind: n.kind, name: n.config.name, subtitle: subtitleFor(n) },
  }));
}

function subtitleFor(n: FlowNode): string {
  const c = n.config;
  if (c.kind === 'dynamic') return c.fetchUrl;
  if (c.kind === 'crud') return `${c.schema.length} cols • h=${c.history ? 'on' : 'off'}`;
  if (c.kind === 'derived') return `${c.pickColumns.length}pick / ${c.computeColumns.length}cmp / ${c.rules.length}rules`;
  return `${c.mode} • ${c.guard}`;
}

function newId(kind: NodeKind, existing: FlowNode[]): string {
  const prefix = kind === 'dynamic' ? 'd' : kind === 'crud' ? 'c' : kind === 'derived' ? 'r' : 'i';
  let i = 1;
  while (existing.some((n) => n.id === `${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function extractKind(dt: DataTransfer): NodeKind | null {
  const direct = dt.getData('application/x-tableblock-kind');
  if (direct && (VALID_KINDS as string[]).includes(direct)) return direct as NodeKind;
  const plain = dt.getData('text/plain');
  if (plain.startsWith('tableblock:')) {
    const k = plain.slice('tableblock:'.length);
    if ((VALID_KINDS as string[]).includes(k)) return k as NodeKind;
  }
  return null;
}

function Editor() {
  const [doc, setDoc] = useState<FlowDoc>({ nodes: [], edges: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<string>('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    fetch('/api/flow')
      .then((r) => r.json())
      .then((d: FlowDoc) => setDoc(d))
      .catch((e) => setStatus(`load error: ${e.message}`));
  }, []);

  const rfNodes = useMemo(() => toRfNodes(doc.nodes), [doc.nodes]);
  const rfEdges: RFEdge[] = useMemo(
    () => doc.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, animated: false })),
    [doc.edges],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setDoc((prev) => {
      const rf = applyNodeChanges(changes, toRfNodes(prev.nodes));
      const byId = new Map(rf.map((n) => [n.id, n]));
      const nextNodes = prev.nodes
        .filter((n) => byId.has(n.id))
        .map((n) => {
          const rfn = byId.get(n.id)!;
          return { ...n, position: rfn.position };
        });
      return { ...prev, nodes: nextNodes };
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setDoc((prev) => {
      const next = applyEdgeChanges(changes, prev.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
      return { ...prev, edges: next.map((e) => ({ id: e.id, source: e.source, target: e.target })) };
    });
  }, []);

  const onConnect: OnConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    setDoc((prev) => {
      if (prev.edges.some((e) => e.source === conn.source && e.target === conn.target)) return prev;
      const next = addEdge(
        { id: `e-${conn.source}-${conn.target}-${Date.now()}`, source: conn.source!, target: conn.target! },
        prev.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      );
      return { ...prev, edges: next.map((e) => ({ id: e.id, source: e.source, target: e.target })) };
    });
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = extractKind(e.dataTransfer);
      if (!kind) {
        setStatus('drop ignored: unknown payload');
        return;
      }
      const inst = instanceRef.current;
      const position = inst
        ? inst.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        : screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setDoc((prev) => {
        const id = newId(kind, prev.nodes);
        const node: FlowNode = { id, kind, position, config: defaultConfig(kind, `${kind}_${id}`) };
        return { ...prev, nodes: [...prev.nodes, node] };
      });
      setStatus(`dropped ${kind} @ (${Math.round(position.x)}, ${Math.round(position.y)})`);
    },
    [screenToFlowPosition],
  );

  const selected = doc.nodes.find((n) => n.id === selectedId) ?? null;
  const onConfigChange = (cfg: NodeConfig) => {
    if (!selectedId) return;
    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === selectedId ? { ...n, config: cfg } : n)),
    }));
  };
  const onDeleteNode = () => {
    if (!selectedId) return;
    setDoc((prev) => ({
      nodes: prev.nodes.filter((n) => n.id !== selectedId),
      edges: prev.edges.filter((e) => e.source !== selectedId && e.target !== selectedId),
    }));
    setSelectedId(null);
  };

  const onSave = async () => {
    setSaving(true);
    setStatus('');
    try {
      const r = await fetch('/api/flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStatus(`saved (${new Date().toLocaleTimeString()})`);
    } catch (e) {
      setStatus(`save error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const onReload = async () => {
    try {
      const r = await fetch('/api/flow');
      const d = (await r.json()) as FlowDoc;
      setDoc(d);
      setStatus(`reloaded (${new Date().toLocaleTimeString()})`);
    } catch (e) {
      setStatus(`reload error: ${(e as Error).message}`);
    }
  };

  const onRun = async () => {
    setRunning(true);
    setStatus('');
    try {
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
      const j = (await r.json()) as RunResult;
      setResult(j);
      setStatus(j.ok ? `run ok (${j.logs.length} logs)` : 'run failed (see logs)');
    } catch (e) {
      setStatus(`run error: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-neutral-800 bg-neutral-950 shrink-0">
        <div className="font-semibold text-sm tracking-tight">table-block <span className="text-neutral-500 font-normal">verification</span></div>
        <div className="ml-4 flex items-center gap-2">
          <button
            onClick={onRun}
            disabled={running}
            className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-900 text-sm font-medium"
          >
            {running ? '실행 중…' : '▶ Run Flow'}
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-sm"
          >
            💾 Save
          </button>
          <button onClick={onReload} className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-sm">
            ↻ Reload
          </button>
        </div>
        <div className="ml-auto text-xs text-neutral-500">{status}</div>
      </header>

      <div className="flex flex-1 min-h-0">
        <NodePalette />
        <div ref={wrapperRef} className="flex-1 relative" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={rfNodes.map((n) => ({ ...n, selected: n.id === selectedId }))}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            onInit={(inst) => { instanceRef.current = inst; }}
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={20} color="#1f2937" />
            <Controls className="!bg-neutral-900 !border-neutral-800" />
            <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.5)" className="!bg-neutral-900" />
          </ReactFlow>
        </div>
        <ConfigPanel node={selected} allNodes={doc.nodes} onChange={onConfigChange} onDelete={onDeleteNode} />
      </div>

      <section className="h-64 border-t border-neutral-800 bg-neutral-950 shrink-0 flex">
        <div className="w-1/2 border-r border-neutral-800 overflow-y-auto p-3">
          <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2">Run Logs</div>
          {!result && <div className="text-sm text-neutral-500">아직 실행 기록이 없습니다. ▶ Run Flow 를 눌러보세요.</div>}
          {result && (
            <ul className="space-y-1 font-mono text-xs">
              {result.logs.map((l, i) => (
                <li key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-300' : 'text-neutral-300'}>
                  <span className="text-neutral-500">[{l.nodeId}]</span> {l.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2">Tables</div>
          {result &&
            Object.entries(result.tables).map(([id, t]) => {
              const node = doc.nodes.find((n) => n.id === id);
              return (
                <div key={id} className="mb-3">
                  <div className="text-xs text-neutral-300 mb-1">
                    <span className="text-neutral-500">{id}</span> · {node?.config.name ?? '?'}
                    {t.blocked && <span className="ml-2 text-red-400">blocked</span>}
                    <span className="ml-2 text-neutral-500">({t.rows.length} rows)</span>
                  </div>
                  {t.rows.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="text-[11px] font-mono border border-neutral-800">
                        <thead className="bg-neutral-900">
                          <tr>
                            {Object.keys(t.rows[0]).map((k) => (
                              <th key={k} className="px-2 py-1 border-r border-neutral-800 text-left text-neutral-400">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {t.rows.slice(0, 20).map((row, i) => (
                            <tr key={i} className="border-t border-neutral-800">
                              {Object.keys(t.rows[0]).map((k) => (
                                <td key={k} className="px-2 py-1 border-r border-neutral-800 text-neutral-300">{JSON.stringify(row[k as keyof typeof row])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </section>
    </div>
  );
}

export default function FlowEditor() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
