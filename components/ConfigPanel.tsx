'use client';
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
  InputJoin,
  PickEntry,
  ComputeColumn,
  ComputeCases,
  ComputeFormula,
  RowGen,
  RowGenKeysFrom,
  RowGenUnion,
  RowGenProduct,
  RowGenGenerate,
  GenerateSpec,
  GenerateRange,
  GenerateCalendar,
  GenerateRecursion,
} from '@/lib/types';

interface Props {
  node: FlowNode | null;
  allNodes: FlowNode[];
  allEdges: FlowEdge[];
  onChange: (cfg: NodeConfig) => void;
  onDelete: () => void;
  onOpenLargeEditor?: () => void;
}

// ── helpers ─────────────────────────────────────────────────────────────

function schemaOfNode(n: FlowNode | undefined): ColumnDef[] {
  if (!n) return [];
  const c = n.config;
  if (c.kind === 'dynamic' || c.kind === 'crud') return c.schema;
  if (c.kind === 'derived') {
    // pickColumns + computeColumns 이름으로 schema 추정 (정확 type 은 모름 → string)
    const seen = new Set<string>();
    const cols: ColumnDef[] = [];
    for (const pe of c.pickColumns) {
      if (!seen.has(pe.col)) { seen.add(pe.col); cols.push({ name: pe.col, type: 'string' }); }
    }
    for (const cc of c.computeColumns) {
      if (!seen.has(cc.name)) { seen.add(cc.name); cols.push({ name: cc.name, type: 'string' }); }
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

function autoKey(a: ColumnDef[], b: ColumnDef[]): string {
  const bs = new Set(b.map((s) => s.name));
  for (const c of a) if (bs.has(c.name)) return c.name;
  return '';
}

// ── small inputs ─────────────────────────────────────────────────────────

function TextField({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

function TextArea({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
      />
    </label>
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

// ── rowGen editor ────────────────────────────────────────────────────────

type RowGenKind = RowGen['kind'] | 'legacy';

function defaultRowGen(kind: RowGen['kind'], firstSourceId: string): RowGen {
  if (kind === 'keys-from') return { kind: 'keys-from', sourceNodeId: firstSourceId, keyColumns: [] };
  if (kind === 'union') return { kind: 'union', parts: firstSourceId ? [{ sourceNodeId: firstSourceId, keyColumns: [] }] : [] };
  if (kind === 'product') return { kind: 'product', parts: firstSourceId ? [{ sourceNodeId: firstSourceId }] : [], joinKeys: [] };
  return {
    kind: 'generate',
    spec: { kind: 'range', column: 'i', from: 0, to: 10, step: 1 },
  };
}

function defaultGenerateSpec(kind: GenerateSpec['kind']): GenerateSpec {
  if (kind === 'range') return { kind: 'range', column: 'i', from: 0, to: 10, step: 1 };
  if (kind === 'calendar') return { kind: 'calendar', column: 'date', start: '2025-01-01', end: '2025-01-07', stepDays: 1 };
  return { kind: 'recursion', column: 'n', seedExpr: '1', nextExpr: 'ctx.prev + 1', whileExpr: 'ctx.prev < 10', maxRows: 100 };
}

function RowGenEditor({
  cfg,
  incoming,
  update,
}: {
  cfg: DerivedConfig;
  incoming: FlowNode[];
  update: (patch: Partial<DerivedConfig>) => void;
}) {
  const sourceOptions = incoming.map((n) => ({ id: n.id, label: `${n.config.name} (${n.kind})`, schema: schemaOfNode(n) }));
  const schemaFor = (id: string): ColumnDef[] => sourceOptions.find((s) => s.id === id)?.schema ?? [];
  const firstSourceId = sourceOptions[0]?.id ?? '';

  const currentKind: RowGenKind = cfg.rowGen?.kind ?? 'legacy';

  const setRowGen = (rg: RowGen | undefined) => update({ rowGen: rg });

  return (
    <div className="space-y-2 border border-violet-500/40 rounded p-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-violet-300">rowGen (행 층)</div>
        <select
          value={currentKind}
          onChange={(e) => {
            const k = e.target.value as RowGenKind;
            if (k === 'legacy') setRowGen(undefined);
            else setRowGen(defaultRowGen(k, firstSourceId));
          }}
          className="bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-xs"
        >
          <option value="legacy">legacy (primary rows)</option>
          <option value="keys-from">keys-from</option>
          <option value="union">union</option>
          <option value="product">product</option>
          <option value="generate">generate</option>
        </select>
      </div>

      {cfg.rowGen?.kind === 'keys-from' && (() => {
        const rg = cfg.rowGen as RowGenKeysFrom;
        const cols = schemaFor(rg.sourceNodeId);
        return (
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-neutral-500 w-14">source:</span>
              <select
                value={rg.sourceNodeId}
                onChange={(e) => setRowGen({ ...rg, sourceNodeId: e.target.value })}
                className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
              >
                {!sourceOptions.some((s) => s.id === rg.sourceNodeId) && (
                  <option value={rg.sourceNodeId}>{rg.sourceNodeId || '(none)'}</option>
                )}
                {sourceOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="text-[10px] text-neutral-500">key columns (비우면 전체):</div>
            <div className="flex flex-wrap gap-1">
              {cols.map((c) => {
                const on = rg.keyColumns.includes(c.name);
                return (
                  <button
                    key={c.name}
                    onClick={() => {
                      const next = on ? rg.keyColumns.filter((k) => k !== c.name) : [...rg.keyColumns, c.name];
                      setRowGen({ ...rg, keyColumns: next });
                    }}
                    className={`px-1.5 py-0.5 rounded text-[11px] border font-mono ${
                      on ? 'bg-violet-500/20 border-violet-500/60 text-violet-200' : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
              {cols.length === 0 && <span className="text-[10px] text-neutral-600">(source 컬럼 없음)</span>}
            </div>
          </div>
        );
      })()}

      {cfg.rowGen?.kind === 'union' && (() => {
        const rg = cfg.rowGen as RowGenUnion;
        const setParts = (parts: RowGenUnion['parts']) => setRowGen({ ...rg, parts });
        return (
          <div className="space-y-1 text-xs">
            {rg.parts.map((p, i) => {
              const cols = schemaFor(p.sourceNodeId);
              return (
                <div key={i} className="border border-neutral-800 rounded p-1.5 space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-neutral-500 w-12">src:</span>
                    <select
                      value={p.sourceNodeId}
                      onChange={(e) => {
                        const next = [...rg.parts];
                        next[i] = { ...next[i], sourceNodeId: e.target.value };
                        setParts(next);
                      }}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
                    >
                      {!sourceOptions.some((s) => s.id === p.sourceNodeId) && (
                        <option value={p.sourceNodeId}>{p.sourceNodeId || '(none)'}</option>
                      )}
                      {sourceOptions.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setParts(rg.parts.filter((_, j) => j !== i))}
                      className="text-neutral-500 hover:text-red-400 px-1"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {cols.map((c) => {
                      const on = p.keyColumns.includes(c.name);
                      return (
                        <button
                          key={c.name}
                          onClick={() => {
                            const next = [...rg.parts];
                            next[i] = {
                              ...next[i],
                              keyColumns: on ? p.keyColumns.filter((k) => k !== c.name) : [...p.keyColumns, c.name],
                            };
                            setParts(next);
                          }}
                          className={`px-1.5 py-0.5 rounded text-[11px] border font-mono ${
                            on ? 'bg-violet-500/20 border-violet-500/60 text-violet-200' : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'
                          }`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <button
              onClick={() => setParts([...rg.parts, { sourceNodeId: firstSourceId, keyColumns: [] }])}
              className="text-[11px] text-sky-400 hover:text-sky-300"
            >
              + add part
            </button>
          </div>
        );
      })()}

      {cfg.rowGen?.kind === 'product' && (() => {
        const rg = cfg.rowGen as RowGenProduct;
        const setParts = (parts: RowGenProduct['parts']) => setRowGen({ ...rg, parts });
        // joinKeys 후보: 모든 parts 의 공통 컬럼
        const schemas = rg.parts.map((p) => schemaFor(p.sourceNodeId));
        const common =
          schemas.length === 0
            ? []
            : schemas
                .slice(1)
                .reduce<string[]>(
                  (acc, s) => acc.filter((n) => s.some((c) => c.name === n)),
                  schemas[0].map((c) => c.name),
                );
        return (
          <div className="space-y-1 text-xs">
            {rg.parts.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-neutral-500 w-12">src{i + 1}:</span>
                <select
                  value={p.sourceNodeId}
                  onChange={(e) => {
                    const next = [...rg.parts];
                    next[i] = { ...next[i], sourceNodeId: e.target.value };
                    setParts(next);
                  }}
                  className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
                >
                  {!sourceOptions.some((s) => s.id === p.sourceNodeId) && (
                    <option value={p.sourceNodeId}>{p.sourceNodeId || '(none)'}</option>
                  )}
                  {sourceOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => setParts(rg.parts.filter((_, j) => j !== i))}
                  className="text-neutral-500 hover:text-red-400 px-1"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => setParts([...rg.parts, { sourceNodeId: firstSourceId }])}
              className="text-[11px] text-sky-400 hover:text-sky-300"
            >
              + add source
            </button>
            <div className="pt-1">
              <div className="text-[10px] text-neutral-500">joinKeys (비우면 cartesian):</div>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {common.map((c) => {
                  const on = rg.joinKeys.includes(c);
                  return (
                    <button
                      key={c}
                      onClick={() => {
                        const next = on ? rg.joinKeys.filter((k) => k !== c) : [...rg.joinKeys, c];
                        setRowGen({ ...rg, joinKeys: next });
                      }}
                      className={`px-1.5 py-0.5 rounded text-[11px] border font-mono ${
                        on ? 'bg-violet-500/20 border-violet-500/60 text-violet-200' : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
                {common.length === 0 && <span className="text-[10px] text-neutral-600">(공통 컬럼 없음 → cartesian)</span>}
              </div>
            </div>
          </div>
        );
      })()}

      {cfg.rowGen?.kind === 'generate' && (() => {
        const rg = cfg.rowGen as RowGenGenerate;
        const sk = rg.spec.kind;
        return (
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-neutral-500 w-12">spec:</span>
              <select
                value={sk}
                onChange={(e) => setRowGen({ ...rg, spec: defaultGenerateSpec(e.target.value as GenerateSpec['kind']) })}
                className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5"
              >
                <option value="range">range</option>
                <option value="calendar">calendar</option>
                <option value="recursion">recursion</option>
              </select>
            </div>
            {rg.spec.kind === 'range' && (() => {
              const s = rg.spec as GenerateRange;
              return (
                <div className="grid grid-cols-2 gap-1">
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-12">col</span>
                    <input value={s.column} onChange={(e) => setRowGen({ ...rg, spec: { ...s, column: e.target.value } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-12">from</span>
                    <input type="number" value={s.from} onChange={(e) => setRowGen({ ...rg, spec: { ...s, from: Number(e.target.value) } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-12">to</span>
                    <input type="number" value={s.to} onChange={(e) => setRowGen({ ...rg, spec: { ...s, to: Number(e.target.value) } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-12">step</span>
                    <input type="number" value={s.step} onChange={(e) => setRowGen({ ...rg, spec: { ...s, step: Number(e.target.value) || 1 } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                </div>
              );
            })()}
            {rg.spec.kind === 'calendar' && (() => {
              const s = rg.spec as GenerateCalendar;
              return (
                <div className="grid grid-cols-2 gap-1">
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-12">col</span>
                    <input value={s.column} onChange={(e) => setRowGen({ ...rg, spec: { ...s, column: e.target.value } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-12">step (d)</span>
                    <input type="number" value={s.stepDays} onChange={(e) => setRowGen({ ...rg, spec: { ...s, stepDays: Number(e.target.value) || 1 } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                  <label className="flex items-center gap-1 col-span-2"><span className="text-neutral-500 w-12">start</span>
                    <input type="date" value={s.start} onChange={(e) => setRowGen({ ...rg, spec: { ...s, start: e.target.value } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                  <label className="flex items-center gap-1 col-span-2"><span className="text-neutral-500 w-12">end</span>
                    <input type="date" value={s.end} onChange={(e) => setRowGen({ ...rg, spec: { ...s, end: e.target.value } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                </div>
              );
            })()}
            {rg.spec.kind === 'recursion' && (() => {
              const s = rg.spec as GenerateRecursion;
              return (
                <div className="space-y-1">
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-14">col</span>
                    <input value={s.column} onChange={(e) => setRowGen({ ...rg, spec: { ...s, column: e.target.value } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-14">seed</span>
                    <input value={s.seedExpr} onChange={(e) => setRowGen({ ...rg, spec: { ...s, seedExpr: e.target.value } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
                      placeholder="e.g. 1" />
                  </label>
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-14">next</span>
                    <input value={s.nextExpr} onChange={(e) => setRowGen({ ...rg, spec: { ...s, nextExpr: e.target.value } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
                      placeholder="ctx.prev * 2" />
                  </label>
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-14">while</span>
                    <input value={s.whileExpr} onChange={(e) => setRowGen({ ...rg, spec: { ...s, whileExpr: e.target.value } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
                      placeholder="ctx.prev < 100" />
                  </label>
                  <label className="flex items-center gap-1"><span className="text-neutral-500 w-14">maxRows</span>
                    <input type="number" value={s.maxRows} onChange={(e) => setRowGen({ ...rg, spec: { ...s, maxRows: Number(e.target.value) || 100 } })}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono" />
                  </label>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Filter wrap (모든 base 변형에 적용) */}
      <div className="pt-1 border-t border-neutral-800">
        <label className="flex items-center gap-1 text-xs">
          <span className="text-neutral-500 w-14">filter</span>
          <input
            value={cfg.rowGenFilter ?? ''}
            placeholder="row.x > 0 (Filter 변형, 비우면 적용 안 함)"
            onChange={(e) => update({ rowGenFilter: e.target.value })}
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
          />
        </label>
      </div>
    </div>
  );
}

// ── Derived sub-sections ─────────────────────────────────────────────────

function InputJoinsEditor({
  cfg,
  primary,
  incoming,
  update,
}: {
  cfg: DerivedConfig;
  primary: FlowNode | undefined;
  incoming: FlowNode[];
  update: (patch: Partial<DerivedConfig>) => void;
}) {
  const nonPrimary = incoming.filter((n) => n.id !== cfg.primaryNodeId);
  const primSchema = schemaOfNode(primary);
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">inputs (lookup keys)</div>
      {nonPrimary.length === 0 && (
        <div className="text-xs text-neutral-600">primary 외 incoming 입력이 없습니다.</div>
      )}
      <div className="space-y-1">
        {nonPrimary.map((n) => {
          const srcSchema = schemaOfNode(n);
          const existing = cfg.inputJoins.find((j) => j.fromNodeId === n.id);
          const suggested = autoKey(primSchema, srcSchema);
          const value = existing?.key ?? suggested;
          // 후보: 양쪽에 모두 있는 컬럼 (교집합) — 없으면 source 의 모든 컬럼
          const primSet = new Set(primSchema.map((s) => s.name));
          const inter = srcSchema.filter((s) => primSet.has(s.name)).map((s) => s.name);
          const options = inter.length > 0 ? inter : srcSchema.map((s) => s.name);
          return (
            <div key={n.id} className="flex items-center gap-2 text-xs">
              <span className="text-neutral-300 flex-1 truncate">{n.config.name} <span className="text-neutral-500">({n.kind})</span></span>
              <span className="text-neutral-500">join on:</span>
              <select
                value={value}
                onChange={(e) => {
                  const next: InputJoin[] = cfg.inputJoins.some((j) => j.fromNodeId === n.id)
                    ? cfg.inputJoins.map((j) => (j.fromNodeId === n.id ? { ...j, key: e.target.value } : j))
                    : [...cfg.inputJoins, { fromNodeId: n.id, key: e.target.value }];
                  update({ inputJoins: next });
                }}
                className="bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
              >
                {value && !options.includes(value) && <option value={value}>{value}</option>}
                {options.length === 0 && <option value="">(no columns)</option>}
                {options.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PickColumnsEditor({
  cfg,
  primary,
  incoming,
  update,
}: {
  cfg: DerivedConfig;
  primary: FlowNode | undefined;
  incoming: FlowNode[];
  update: (patch: Partial<DerivedConfig>) => void;
}) {
  const sources: { id: string; label: string; schema: ColumnDef[] }[] = [];
  if (primary) sources.push({ id: 'primary', label: `primary (${primary.config.name})`, schema: schemaOfNode(primary) });
  for (const n of incoming) {
    if (n.id === cfg.primaryNodeId) continue;
    sources.push({ id: n.id, label: `${n.config.name} (${n.kind})`, schema: schemaOfNode(n) });
  }
  const schemaFor = (from: string): ColumnDef[] => sources.find((s) => s.id === from)?.schema ?? [];

  const setPicks = (next: PickEntry[]) => update({ pickColumns: next });

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">pickColumns</div>
      <div className="space-y-1">
        {cfg.pickColumns.map((pe, i) => {
          const cols = schemaFor(pe.from);
          return (
            <div key={i} className="flex items-center gap-1 text-xs">
              <ReorderBtns
                onUp={() => setPicks(moveItem(cfg.pickColumns, i, -1))}
                onDown={() => setPicks(moveItem(cfg.pickColumns, i, +1))}
              />
              <select
                value={pe.from}
                onChange={(e) => {
                  const next = [...cfg.pickColumns];
                  next[i] = { ...next[i], from: e.target.value };
                  setPicks(next);
                }}
                className="bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
              >
                {sources.length === 0 && <option value={pe.from}>{pe.from}</option>}
                {pe.from && !sources.some((s) => s.id === pe.from) && (
                  <option value={pe.from}>{pe.from} (?)</option>
                )}
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <select
                value={pe.col}
                onChange={(e) => {
                  const next = [...cfg.pickColumns];
                  next[i] = { ...next[i], col: e.target.value };
                  setPicks(next);
                }}
                className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 font-mono"
              >
                {pe.col && !cols.some((c) => c.name === pe.col) && (
                  <option value={pe.col}>{pe.col} (?)</option>
                )}
                {cols.length === 0 && <option value="">(no cols)</option>}
                {cols.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={() => setPicks(cfg.pickColumns.filter((_, j) => j !== i))}
                className="text-neutral-500 hover:text-red-400 px-1"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          onClick={() => {
            const defFrom = sources[0]?.id ?? 'primary';
            const defCol = schemaFor(defFrom)[0]?.name ?? '';
            setPicks([...cfg.pickColumns, { from: defFrom, col: defCol }]);
          }}
          disabled={sources.length === 0}
          className="text-xs text-sky-400 hover:text-sky-300 disabled:text-neutral-600"
        >
          + add pick
        </button>
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              const existing = new Set(
                cfg.pickColumns.filter((p) => p.from === s.id).map((p) => p.col),
              );
              const additions: PickEntry[] = s.schema
                .filter((c) => !existing.has(c.name))
                .map((c) => ({ from: s.id, col: c.name }));
              setPicks([...cfg.pickColumns, ...additions]);
            }}
            className="text-xs text-sky-400 hover:text-sky-300"
          >
            Pick all from {s.id === 'primary' ? 'primary' : sources.find((x) => x.id === s.id)?.label.split(' ')[0]}
          </button>
        ))}
        <button
          onClick={() => setPicks([])}
          className="text-xs text-neutral-400 hover:text-neutral-200"
        >
          Clear picks
        </button>
      </div>
    </div>
  );
}

function ComputeColumnsEditor({
  cfg,
  update,
}: {
  cfg: DerivedConfig;
  update: (patch: Partial<DerivedConfig>) => void;
}) {
  const setComputes = (next: ComputeColumn[]) => update({ computeColumns: next });

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">computeColumns</div>
      <div className="space-y-2">
        {cfg.computeColumns.map((cc, i) => {
          const mode = cc.mode ?? 'formula';
          return (
            <div key={i} className="space-y-1 border border-neutral-800 rounded p-2">
              <div className="flex items-center gap-1">
                <ReorderBtns
                  onUp={() => setComputes(moveItem(cfg.computeColumns, i, -1))}
                  onDown={() => setComputes(moveItem(cfg.computeColumns, i, +1))}
                />
                <input
                  value={cc.name}
                  placeholder="col name"
                  onChange={(e) => {
                    const next = [...cfg.computeColumns];
                    next[i] = { ...next[i], name: e.target.value } as ComputeColumn;
                    setComputes(next);
                  }}
                  className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                />
                <button
                  onClick={() =>
                    setComputes(cfg.computeColumns.filter((_, j) => j !== i))
                  }
                  className="text-neutral-500 hover:text-red-400 px-1 text-xs"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-neutral-500">mode:</span>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={mode === 'formula'}
                    onChange={() => {
                      const next = [...cfg.computeColumns];
                      const fallbackFormula =
                        mode === 'cases' ? ((cc as ComputeCases).default || '') : (cc as ComputeFormula).formula;
                      next[i] = { name: cc.name, mode: 'formula', formula: fallbackFormula } as ComputeFormula;
                      setComputes(next);
                    }}
                  />
                  formula
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={mode === 'cases'}
                    onChange={() => {
                      const next = [...cfg.computeColumns];
                      const fallbackDefault =
                        mode === 'formula' ? (cc as ComputeFormula).formula : ((cc as ComputeCases).default || 'null');
                      next[i] = {
                        name: cc.name,
                        mode: 'cases',
                        cases: mode === 'cases' ? (cc as ComputeCases).cases : [],
                        default: fallbackDefault || 'null',
                      } as ComputeCases;
                      setComputes(next);
                    }}
                  />
                  cases
                </label>
              </div>

              {mode === 'formula' ? (
                <input
                  value={(cc as ComputeFormula).formula}
                  placeholder="formula (e.g. row.price * 1.1)"
                  onChange={(e) => {
                    const next = [...cfg.computeColumns];
                    next[i] = { ...next[i], formula: e.target.value } as ComputeFormula;
                    setComputes(next);
                  }}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                />
              ) : (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500">cases (first match wins)</div>
                  {(cc as ComputeCases).cases.map((cs, ci) => (
                    <div key={ci} className="flex items-center gap-1">
                      <span className="text-[10px] text-neutral-500 w-10">WHEN</span>
                      <input
                        value={cs.when}
                        placeholder="row.price > 100"
                        onChange={(e) => {
                          const next = [...cfg.computeColumns];
                          const cur = next[i] as ComputeCases;
                          const cases = [...cur.cases];
                          cases[ci] = { ...cases[ci], when: e.target.value };
                          next[i] = { ...cur, cases };
                          setComputes(next);
                        }}
                        className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                      />
                      <span className="text-[10px] text-neutral-500">→</span>
                      <input
                        value={cs.then}
                        placeholder="'high'"
                        onChange={(e) => {
                          const next = [...cfg.computeColumns];
                          const cur = next[i] as ComputeCases;
                          const cases = [...cur.cases];
                          cases[ci] = { ...cases[ci], then: e.target.value };
                          next[i] = { ...cur, cases };
                          setComputes(next);
                        }}
                        className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                      />
                      <button
                        onClick={() => {
                          const next = [...cfg.computeColumns];
                          const cur = next[i] as ComputeCases;
                          next[i] = { ...cur, cases: cur.cases.filter((_, j) => j !== ci) };
                          setComputes(next);
                        }}
                        className="text-neutral-500 hover:text-red-400 px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const next = [...cfg.computeColumns];
                      const cur = next[i] as ComputeCases;
                      next[i] = { ...cur, cases: [...cur.cases, { when: 'true', then: 'null' }] };
                      setComputes(next);
                    }}
                    className="text-[11px] text-sky-400 hover:text-sky-300"
                  >
                    + add case
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-neutral-500 w-10">DEFAULT</span>
                    <input
                      value={(cc as ComputeCases).default}
                      placeholder="'low' or null"
                      onChange={(e) => {
                        const next = [...cfg.computeColumns];
                        const cur = next[i] as ComputeCases;
                        next[i] = { ...cur, default: e.target.value };
                        setComputes(next);
                      }}
                      className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={() =>
          setComputes([
            ...cfg.computeColumns,
            { name: 'new_col', mode: 'formula', formula: 'row.id' } as ComputeFormula,
          ])
        }
        className="mt-1 text-xs text-sky-400 hover:text-sky-300"
      >
        + add compute column
      </button>
    </div>
  );
}

// ── main ─────────────────────────────────────────────────────────────────

export function NodeEditorBody({
  node,
  allNodes,
  allEdges,
  onChange,
  wide,
}: {
  node: FlowNode;
  allNodes: FlowNode[];
  allEdges: FlowEdge[];
  onChange: (cfg: NodeConfig) => void;
  wide?: boolean;
}) {
  const cfg = node.config;
  const update = (patch: Partial<NodeConfig>) => onChange({ ...cfg, ...patch } as NodeConfig);
  const updateDerived = (patch: Partial<DerivedConfig>) => onChange({ ...(cfg as DerivedConfig), ...patch });

  return (
    <div className={`space-y-4 ${wide ? 'text-sm' : ''}`}>
      <TextField label="name" value={cfg.name} onChange={(v) => update({ name: v } as Partial<NodeConfig>)} />

      {cfg.kind === 'dynamic' && (
        <>
          <TextField label="fetchUrl" value={(cfg as DynamicConfig).fetchUrl} onChange={(v) => update({ fetchUrl: v } as Partial<DynamicConfig>)} mono />
          <div className="text-[11px] text-neutral-500">http(s):// 이면 실제 fetch, 그 외는 schema로 mock rows 생성</div>
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
              try { update({ params: JSON.parse(v) } as Partial<DynamicConfig>); } catch {}
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
            rows={wide ? 14 : 8}
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
        const primary = allNodes.find((n) => n.id === dcfg.primaryNodeId);
        return (
          <>
            <RowGenEditor cfg={dcfg} incoming={incoming} update={updateDerived} />
            <label className="block">
              <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">primary input (셀 층 lookup용)</div>
              <select
                value={dcfg.primaryNodeId}
                onChange={(e) => updateDerived({ primaryNodeId: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
              >
                <option value="">(첫 번째 incoming)</option>
                {allNodes.filter((n) => n.id !== node.id).map((n) => (
                  <option key={n.id} value={n.id}>{n.config.name} ({n.kind})</option>
                ))}
              </select>
            </label>
            <InputJoinsEditor cfg={dcfg} primary={primary} incoming={incoming} update={updateDerived} />
            <PickColumnsEditor cfg={dcfg} primary={primary} incoming={incoming} update={updateDerived} />
            <ComputeColumnsEditor cfg={dcfg} update={updateDerived} />
          </>
        );
      })()}

      {cfg.kind === 'interceptor' && (
        <>
          <label className="block">
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">mode</div>
            <select
              value={(cfg as InterceptorConfig).mode}
              onChange={(e) => update({ mode: e.target.value as InterceptorMode } as Partial<InterceptorConfig>)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
            >
              <option value="pass">pass</option>
              <option value="block-on-fail">block-on-fail</option>
              <option value="filter">filter</option>
            </select>
          </label>
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
          <div className="text-[11px] text-neutral-500">예: <code>mail:to=ops@x</code>, <code>webhook:url=...</code>, <code>log:tag</code></div>
        </>
      )}
    </div>
  );
}

export default function ConfigPanel({ node, allNodes, allEdges, onChange, onDelete, onOpenLargeEditor }: Props) {
  if (!node) {
    return (
      <div className="w-80 shrink-0 border-l border-neutral-800 bg-neutral-950 p-4 overflow-y-auto">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Config</div>
        <div className="text-sm text-neutral-500">노드를 선택하면 해당 타입의 설정이 표시됩니다.</div>
      </div>
    );
  }

  const cfg = node.config;

  return (
    <div className="w-80 shrink-0 border-l border-neutral-800 bg-neutral-950 p-4 overflow-y-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-500">{cfg.kind}</div>
          <div className="text-sm text-neutral-300">id: <span className="font-mono text-neutral-400">{node.id}</span></div>
        </div>
        <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300">노드 삭제</button>
      </div>

      {onOpenLargeEditor && (
        <button
          onClick={onOpenLargeEditor}
          className="w-full px-3 py-1.5 rounded bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-violet-200 text-xs font-medium"
        >
          ⤢ 큰 팝업으로 열기 (편집 + 미리보기)
        </button>
      )}

      <NodeEditorBody node={node} allNodes={allNodes} allEdges={allEdges} onChange={onChange} />
    </div>
  );
}

