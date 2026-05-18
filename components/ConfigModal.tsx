'use client';
import { useEffect } from 'react';
import type {
  FlowNode,
  FlowEdge,
  NodeConfig,
  ColumnDef,
  DynamicConfig,
  CrudConfig,
  DerivedConfig,
  InterceptorConfig,
  InterceptorMode,
  CellRule,
  CellCases,
  CellFormula,
  CellPick,
  RowGenSpec,
  KeysFromSpec,
  UnionSpec,
  FilterSpec,
} from '@/lib/types';

interface Props {
  node: FlowNode | null;
  allNodes: FlowNode[];
  allEdges: FlowEdge[];
  onChange: (cfg: NodeConfig) => void;
  onDelete: () => void;
  onClose: () => void;
}

// ── helpers ─────────────────────────────────────────────────────────────

function schemaOfNode(n: FlowNode | undefined): ColumnDef[] {
  if (!n) return [];
  const c = n.config;
  if (c.kind === 'dynamic' || c.kind === 'crud') return c.schema;
  if (c.kind === 'derived') {
    const seen = new Set<string>();
    const cols: ColumnDef[] = [];
    for (const r of c.cellRules) {
      if (!r.name || seen.has(r.name)) continue;
      seen.add(r.name);
      cols.push({ name: r.name, type: 'string' });
    }
    return cols;
  }
  return [];
}

function moveItem<T>(arr: T[], idx: number, delta: number): T[] {
  const j = idx + delta;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[idx], next[j]] = [next[j], next[idx]];
  return next;
}

function incomingSources(node: FlowNode, allNodes: FlowNode[], allEdges: FlowEdge[]): FlowNode[] {
  const ids = allEdges.filter((e) => e.target === node.id).map((e) => e.source);
  return ids.map((id) => allNodes.find((n) => n.id === id)).filter((x): x is FlowNode => !!x);
}

// ── small inputs ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm ${mono ? 'font-mono' : ''}`}
      />
    </Field>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <Field label={label}>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
      />
    </Field>
  );
}

function SchemaEditor({ schema, onChange }: { schema: ColumnDef[]; onChange: (s: ColumnDef[]) => void }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">Schema</div>
      <div className="space-y-1">
        {schema.map((c, i) => (
          <div key={i} className="flex gap-1">
            <input
              value={c.name}
              onChange={(e) => {
                const ns = [...schema];
                ns[i] = { ...ns[i], name: e.target.value };
                onChange(ns);
              }}
              className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
            />
            <select
              value={c.type}
              onChange={(e) => {
                const ns = [...schema];
                ns[i] = { ...ns[i], type: e.target.value as ColumnDef['type'] };
                onChange(ns);
              }}
              className="bg-neutral-900 border border-neutral-700 rounded px-1 text-xs"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            <button
              onClick={() => onChange(schema.filter((_, j) => j !== i))}
              className="px-2 text-neutral-500 hover:text-red-400 text-xs"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => onChange([...schema, { name: `col${schema.length + 1}`, type: 'string' }])}
        className="mt-1 text-xs text-sky-400 hover:text-sky-300"
      >
        + add column
      </button>
    </div>
  );
}

function ReorderBtns({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex flex-col text-[10px] leading-none">
      <button onClick={onUp} className="text-neutral-500 hover:text-sky-300 px-1">▲</button>
      <button onClick={onDown} className="text-neutral-500 hover:text-sky-300 px-1">▼</button>
    </div>
  );
}

// ── Derived: rowGen 편집기 ──────────────────────────────────────────────
//
// MVP UX: rowGen 의 *최상위* type 만 케이스로 노출 (keysFrom / union / filter).
// - keysFrom: source node + 단일 key 컬럼
// - union: KeysFrom 둘의 합집합 (MVP — 더 깊은 중첩은 UI 미지원)
// - filter: KeysFrom + predicate
// → 더 복잡한 중첩(예: filter(union(...))) 은 후순위. docs/mvp.md 에 명시.

function asKeysFrom(spec: RowGenSpec): KeysFromSpec {
  if (spec.type === 'keysFrom') return spec;
  if (spec.type === 'filter') return asKeysFrom(spec.source);
  if (spec.type === 'union') {
    const first = spec.sources[0];
    if (first) return asKeysFrom(first);
  }
  return { type: 'keysFrom', fromNodeId: '', keys: ['id'] };
}

function KeysFromEditor({
  spec,
  incoming,
  onChange,
}: {
  spec: KeysFromSpec;
  incoming: FlowNode[];
  onChange: (next: KeysFromSpec) => void;
}) {
  const src = incoming.find((n) => n.id === spec.fromNodeId);
  const cols = schemaOfNode(src);
  const keyVal = spec.keys[0] ?? '';
  return (
    <div className="space-y-1.5 border border-neutral-800 rounded p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-neutral-500 w-14">source</span>
        <select
          value={spec.fromNodeId}
          onChange={(e) => onChange({ ...spec, fromNodeId: e.target.value })}
          className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
        >
          <option value="">(none)</option>
          {incoming.map((n) => (
            <option key={n.id} value={n.id}>
              {n.config.name} ({n.kind})
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-neutral-500 w-14">key col</span>
        <select
          value={keyVal}
          onChange={(e) => onChange({ ...spec, keys: [e.target.value] })}
          className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
        >
          {keyVal && !cols.some((c) => c.name === keyVal) && <option value={keyVal}>{keyVal} (?)</option>}
          {cols.length === 0 && <option value="">(no cols)</option>}
          {cols.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="text-[10px] text-neutral-600">
        MVP 가정: 단일 키 + 다른 incoming 들도 같은 컬럼명으로 lookup. (V-0008)
      </div>
    </div>
  );
}

function RowGenEditor({
  spec,
  incoming,
  onChange,
}: {
  spec: RowGenSpec;
  incoming: FlowNode[];
  onChange: (next: RowGenSpec) => void;
}) {
  const type = spec.type;

  const switchType = (next: 'keysFrom' | 'union' | 'filter') => {
    if (next === type) return;
    const base = asKeysFrom(spec);
    if (next === 'keysFrom') {
      onChange(base);
    } else if (next === 'union') {
      const second: KeysFromSpec = { type: 'keysFrom', fromNodeId: '', keys: base.keys };
      onChange({ type: 'union', sources: [base, second] });
    } else {
      onChange({ type: 'filter', source: base, predicate: 'true' });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-neutral-500">type:</span>
        {(['keysFrom', 'union', 'filter'] as const).map((t) => (
          <label key={t} className="flex items-center gap-1">
            <input type="radio" checked={type === t} onChange={() => switchType(t)} />
            <span className="font-mono">{t}</span>
          </label>
        ))}
      </div>

      {type === 'keysFrom' && (
        <KeysFromEditor spec={spec as KeysFromSpec} incoming={incoming} onChange={onChange} />
      )}

      {type === 'union' && (() => {
        const u = spec as UnionSpec;
        const a = (u.sources[0] && u.sources[0].type === 'keysFrom' ? u.sources[0] : asKeysFrom(u.sources[0] ?? a0())) as KeysFromSpec;
        const b = (u.sources[1] && u.sources[1].type === 'keysFrom' ? u.sources[1] : asKeysFrom(u.sources[1] ?? a0())) as KeysFromSpec;
        return (
          <div className="space-y-1.5">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">source A</div>
            <KeysFromEditor spec={a} incoming={incoming} onChange={(na) => onChange({ type: 'union', sources: [na, b] })} />
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">source B</div>
            <KeysFromEditor spec={b} incoming={incoming} onChange={(nb) => onChange({ type: 'union', sources: [a, nb] })} />
            <div className="text-[10px] text-neutral-600">
              두 KeysFrom 의 키 합집합 (dedupe). MVP — 더 깊은 중첩은 미지원.
            </div>
          </div>
        );
      })()}

      {type === 'filter' && (() => {
        const f = spec as FilterSpec;
        const inner = asKeysFrom(f.source);
        return (
          <div className="space-y-1.5">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">source</div>
            <KeysFromEditor
              spec={inner}
              incoming={incoming}
              onChange={(ni) => onChange({ type: 'filter', source: ni, predicate: f.predicate })}
            />
            <Field label="predicate (row 컨텍스트)">
              <input
                value={f.predicate}
                onChange={(e) => onChange({ type: 'filter', source: inner, predicate: e.target.value })}
                placeholder="row.amt > 50"
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
              />
            </Field>
            <div className="text-[10px] text-neutral-600">predicate=true 인 행만 통과. MVP — source 는 단일 KeysFrom.</div>
          </div>
        );
      })()}
    </div>
  );
}

function a0(): KeysFromSpec {
  return { type: 'keysFrom', fromNodeId: '', keys: ['id'] };
}

// ── Derived: cellRules 편집기 ───────────────────────────────────────────

function CellRulesEditor({
  rules,
  pickSources,
  onChange,
}: {
  rules: CellRule[];
  pickSources: { id: string; label: string; schema: ColumnDef[] }[];
  onChange: (next: CellRule[]) => void;
}) {
  const setAt = (i: number, r: CellRule) => {
    const next = [...rules];
    next[i] = r;
    onChange(next);
  };
  const remove = (i: number) => onChange(rules.filter((_, j) => j !== i));

  const schemaFor = (from: string): ColumnDef[] => pickSources.find((s) => s.id === from)?.schema ?? [];

  return (
    <div className="space-y-2">
      {rules.map((r, i) => (
        <div key={i} className="space-y-1 border border-neutral-800 rounded p-2">
          <div className="flex items-center gap-1">
            <ReorderBtns onUp={() => onChange(moveItem(rules, i, -1))} onDown={() => onChange(moveItem(rules, i, +1))} />
            <input
              value={r.name}
              placeholder="output col name"
              onChange={(e) => setAt(i, { ...r, name: e.target.value } as CellRule)}
              className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
            />
            <button onClick={() => remove(i)} className="text-neutral-500 hover:text-red-400 px-1 text-xs">✕</button>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-neutral-500">mode:</span>
            {(['pick', 'formula', 'cases'] as const).map((m) => (
              <label key={m} className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={r.mode === m}
                  onChange={() => {
                    if (m === 'pick') {
                      const def = (pickSources[0]?.id ?? '');
                      setAt(i, { name: r.name, mode: 'pick', from: def, col: r.name } as CellPick);
                    } else if (m === 'formula') {
                      const fallback = r.mode === 'cases' ? (r as CellCases).default : r.mode === 'formula' ? (r as CellFormula).formula : 'null';
                      setAt(i, { name: r.name, mode: 'formula', formula: fallback || 'null' } as CellFormula);
                    } else {
                      const fallback = r.mode === 'formula' ? (r as CellFormula).formula : r.mode === 'cases' ? (r as CellCases).default : 'null';
                      setAt(i, {
                        name: r.name,
                        mode: 'cases',
                        cases: r.mode === 'cases' ? (r as CellCases).cases : [],
                        default: fallback || 'null',
                      } as CellCases);
                    }
                  }}
                />
                {m}
              </label>
            ))}
          </div>

          {r.mode === 'pick' && (
            <div className="flex items-center gap-1 text-xs">
              <select
                value={r.from}
                onChange={(e) => setAt(i, { ...r, from: e.target.value } as CellPick)}
                className="bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
              >
                {r.from && !pickSources.some((s) => s.id === r.from) && (
                  <option value={r.from}>{r.from} (?)</option>
                )}
                {pickSources.length === 0 && <option value="">(no sources)</option>}
                {pickSources.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <select
                value={r.col}
                onChange={(e) => setAt(i, { ...r, col: e.target.value } as CellPick)}
                className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
              >
                {r.col && !schemaFor(r.from).some((c) => c.name === r.col) && (
                  <option value={r.col}>{r.col} (?)</option>
                )}
                {schemaFor(r.from).length === 0 && <option value="">(no cols)</option>}
                {schemaFor(r.from).map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {r.mode === 'formula' && (
            <input
              value={r.formula}
              placeholder="row.price * 1.1"
              onChange={(e) => setAt(i, { ...r, formula: e.target.value } as CellFormula)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
            />
          )}

          {r.mode === 'cases' && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">cases (first match wins)</div>
              {r.cases.map((cs, ci) => (
                <div key={ci} className="flex items-center gap-1">
                  <span className="text-[10px] text-neutral-500 w-10">WHEN</span>
                  <input
                    value={cs.when}
                    placeholder="row.price > 100"
                    onChange={(e) => {
                      const cases = [...r.cases];
                      cases[ci] = { ...cases[ci], when: e.target.value };
                      setAt(i, { ...r, cases } as CellCases);
                    }}
                    className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                  />
                  <span className="text-[10px] text-neutral-500">→</span>
                  <input
                    value={cs.then}
                    placeholder="'high'"
                    onChange={(e) => {
                      const cases = [...r.cases];
                      cases[ci] = { ...cases[ci], then: e.target.value };
                      setAt(i, { ...r, cases } as CellCases);
                    }}
                    className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                  />
                  <button
                    onClick={() => setAt(i, { ...r, cases: r.cases.filter((_, j) => j !== ci) } as CellCases)}
                    className="text-neutral-500 hover:text-red-400 px-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => setAt(i, { ...r, cases: [...r.cases, { when: 'true', then: 'null' }] } as CellCases)}
                className="text-[11px] text-sky-400 hover:text-sky-300"
              >
                + add case
              </button>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-neutral-500 w-10">DEFAULT</span>
                <input
                  value={r.default}
                  placeholder="'low' or null"
                  onChange={(e) => setAt(i, { ...r, default: e.target.value } as CellCases)}
                  className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                />
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            const def = pickSources[0];
            const col = def?.schema[0]?.name ?? '';
            onChange([
              ...rules,
              { name: col || 'col', mode: 'pick', from: def?.id ?? '', col } as CellPick,
            ]);
          }}
          className="text-xs text-sky-400 hover:text-sky-300"
        >
          + pick
        </button>
        <button
          onClick={() =>
            onChange([
              ...rules,
              { name: `c${rules.length + 1}`, mode: 'formula', formula: 'row.id' } as CellFormula,
            ])
          }
          className="text-xs text-sky-400 hover:text-sky-300"
        >
          + formula
        </button>
        <button
          onClick={() =>
            onChange([
              ...rules,
              { name: `c${rules.length + 1}`, mode: 'cases', cases: [], default: 'null' } as CellCases,
            ])
          }
          className="text-xs text-sky-400 hover:text-sky-300"
        >
          + cases
        </button>
        {pickSources.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              const existing = new Set(rules.filter((r) => r.mode === 'pick' && (r as CellPick).from === s.id).map((r) => (r as CellPick).col));
              const additions: CellRule[] = s.schema
                .filter((c) => !existing.has(c.name))
                .map((c) => ({ name: c.name, mode: 'pick', from: s.id, col: c.name }) as CellPick);
              onChange([...rules, ...additions]);
            }}
            className="text-xs text-sky-400 hover:text-sky-300"
          >
            pick all from {s.label.split(' ')[0]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────

export default function ConfigModal({ node, allNodes, allEdges, onChange, onDelete, onClose }: Props) {
  useEffect(() => {
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [node, onClose]);

  if (!node) return null;

  const cfg = node.config;
  const update = (patch: Partial<NodeConfig>) => onChange({ ...cfg, ...patch } as NodeConfig);
  const updateDerived = (patch: Partial<DerivedConfig>) => onChange({ ...(cfg as DerivedConfig), ...patch });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[min(900px,92vw)] max-h-[88vh] bg-neutral-950 border border-neutral-800 rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-neutral-800 shrink-0">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-500">{cfg.kind}</div>
            <div className="text-base text-neutral-200 font-medium">
              {cfg.name || '(unnamed)'}
              <span className="ml-2 text-xs text-neutral-500 font-mono">id: {node.id}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (confirm(`delete node "${cfg.name}"?`)) {
                  onDelete();
                  onClose();
                }
              }}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-900/40 rounded"
            >
              노드 삭제
            </button>
            <button
              onClick={onClose}
              className="text-sm text-neutral-400 hover:text-neutral-100 px-2 py-1 border border-neutral-800 rounded"
            >
              ✕ 닫기 (Esc)
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <TextField label="name" value={cfg.name} onChange={(v) => update({ name: v } as Partial<NodeConfig>)} />

          {cfg.kind === 'dynamic' && (
            <>
              <TextField
                label="fetchUrl"
                value={(cfg as DynamicConfig).fetchUrl}
                onChange={(v) => update({ fetchUrl: v } as Partial<DynamicConfig>)}
                mono
              />
              <div className="text-[11px] text-neutral-500">http(s):// 이면 실제 fetch, 그 외는 schema 로 mock rows 생성</div>
              <SchemaEditor
                schema={(cfg as DynamicConfig).schema}
                onChange={(s) => update({ schema: s } as Partial<DynamicConfig>)}
              />
              <TextField
                label="cacheTtlSec"
                value={String((cfg as DynamicConfig).cacheTtlSec)}
                onChange={(v) => update({ cacheTtlSec: Number(v) || 0 } as Partial<DynamicConfig>)}
              />
              <TextArea
                label="params (JSON)"
                value={JSON.stringify((cfg as DynamicConfig).params, null, 2)}
                onChange={(v) => {
                  try {
                    update({ params: JSON.parse(v) } as Partial<DynamicConfig>);
                  } catch {}
                }}
                rows={3}
              />
            </>
          )}

          {cfg.kind === 'crud' && (
            <>
              <SchemaEditor
                schema={(cfg as CrudConfig).schema}
                onChange={(s) => update({ schema: s } as Partial<CrudConfig>)}
              />
              <TextArea
                label="rows (JSON array)"
                value={(cfg as CrudConfig).rowsJson}
                onChange={(v) => update({ rowsJson: v } as Partial<CrudConfig>)}
                rows={10}
              />
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(cfg as CrudConfig).history}
                    onChange={(e) => update({ history: e.target.checked } as Partial<CrudConfig>)}
                  />
                  opts.history
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(cfg as CrudConfig).audit}
                    onChange={(e) => update({ audit: e.target.checked } as Partial<CrudConfig>)}
                  />
                  opts.audit
                </label>
              </div>
            </>
          )}

          {cfg.kind === 'derived' && (() => {
            const dcfg = cfg as DerivedConfig;
            const incoming = incomingSources(node, allNodes, allEdges);
            const pickSources = incoming.map((n) => ({
              id: n.id,
              label: `${n.config.name} (${n.kind})`,
              schema: schemaOfNode(n),
            }));
            return (
              <>
                <section>
                  <div className="text-xs uppercase tracking-wider text-neutral-400 mb-2 border-b border-neutral-800 pb-1">
                    ① Row Layer · <span className="text-neutral-600 font-mono normal-case">rowGen</span>
                  </div>
                  <RowGenEditor
                    spec={dcfg.rowGen}
                    incoming={incoming}
                    onChange={(rg) => updateDerived({ rowGen: rg })}
                  />
                </section>

                <section>
                  <div className="text-xs uppercase tracking-wider text-neutral-400 mb-2 border-b border-neutral-800 pb-1">
                    ② Cell Layer · <span className="text-neutral-600 font-mono normal-case">cellRules</span>
                  </div>
                  <CellRulesEditor
                    rules={dcfg.cellRules}
                    pickSources={pickSources}
                    onChange={(rules) => updateDerived({ cellRules: rules })}
                  />
                </section>
              </>
            );
          })()}

          {cfg.kind === 'interceptor' && (
            <>
              <Field label="mode">
                <select
                  value={(cfg as InterceptorConfig).mode}
                  onChange={(e) => update({ mode: e.target.value as InterceptorMode } as Partial<InterceptorConfig>)}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                >
                  <option value="pass">pass</option>
                  <option value="block-on-fail">block-on-fail</option>
                  <option value="filter">filter</option>
                </select>
              </Field>
              <TextField
                label="guard (predicate)"
                value={(cfg as InterceptorConfig).guard}
                onChange={(v) => update({ guard: v } as Partial<InterceptorConfig>)}
                mono
              />
              <TextField
                label="effect (description)"
                value={(cfg as InterceptorConfig).effect}
                onChange={(v) => update({ effect: v } as Partial<InterceptorConfig>)}
                mono
              />
              <div className="text-[11px] text-neutral-500">
                예: <code>mail:to=ops@x</code>, <code>webhook:url=...</code>, <code>log:tag</code>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
