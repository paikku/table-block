'use client';
import type {
  FlowNode,
  NodeConfig,
  ColumnDef,
  DynamicConfig,
  CrudConfig,
  DerivedConfig,
  InterceptorConfig,
  InterceptorMode,
} from '@/lib/types';

interface Props {
  node: FlowNode | null;
  allNodes: FlowNode[];
  onChange: (cfg: NodeConfig) => void;
  onDelete: () => void;
}

function primaryColumnNames(allNodes: FlowNode[], primaryId: string): string[] {
  if (!primaryId) return [];
  const p = allNodes.find((n) => n.id === primaryId);
  if (!p) return [];
  const c = p.config;
  if (c.kind === 'dynamic' || c.kind === 'crud') return c.schema.map((s) => s.name);
  if (c.kind === 'derived') {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const n of c.pickColumns) if (!seen.has(n)) { seen.add(n); names.push(n); }
    for (const cc of c.computeColumns) if (!seen.has(cc.name)) { seen.add(cc.name); names.push(cc.name); }
    return names;
  }
  return [];
}

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

export default function ConfigPanel({ node, allNodes, onChange, onDelete }: Props) {
  if (!node) {
    return (
      <div className="w-80 shrink-0 border-l border-neutral-800 bg-neutral-950 p-4 overflow-y-auto">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Config</div>
        <div className="text-sm text-neutral-500">노드를 선택하면 해당 타입의 설정이 표시됩니다.</div>
      </div>
    );
  }

  const cfg = node.config;
  const update = (patch: Partial<NodeConfig>) => onChange({ ...cfg, ...patch } as NodeConfig);

  return (
    <div className="w-80 shrink-0 border-l border-neutral-800 bg-neutral-950 p-4 overflow-y-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-500">{cfg.kind}</div>
          <div className="text-sm text-neutral-300">id: <span className="font-mono text-neutral-400">{node.id}</span></div>
        </div>
        <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300">노드 삭제</button>
      </div>

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
            rows={8}
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

      {cfg.kind === 'derived' && (
        <>
          <label className="block">
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">primary input</div>
            <select
              value={(cfg as DerivedConfig).primaryNodeId}
              onChange={(e) => update({ primaryNodeId: e.target.value } as Partial<DerivedConfig>)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
            >
              <option value="">(첫 번째 incoming)</option>
              {allNodes.filter((n) => n.id !== node.id).map((n) => (
                <option key={n.id} value={n.id}>{n.config.name} ({n.kind})</option>
              ))}
            </select>
          </label>
          <div>
            <TextField
              label="pickColumns (comma)"
              value={(cfg as DerivedConfig).pickColumns.join(', ')}
              onChange={(v) => update({ pickColumns: v.split(',').map((s) => s.trim()).filter(Boolean) } as Partial<DerivedConfig>)}
              mono
            />
            <div className="mt-1 flex gap-2">
              <button
                disabled={!primaryColumnNames(allNodes, (cfg as DerivedConfig).primaryNodeId).length}
                onClick={() =>
                  update({
                    pickColumns: primaryColumnNames(allNodes, (cfg as DerivedConfig).primaryNodeId),
                  } as Partial<DerivedConfig>)
                }
                className="text-xs text-sky-400 hover:text-sky-300 disabled:text-neutral-600 disabled:hover:text-neutral-600"
              >
                Pick all from primary
              </button>
              <button
                onClick={() => update({ pickColumns: [] } as Partial<DerivedConfig>)}
                className="text-xs text-neutral-400 hover:text-neutral-200"
              >
                Clear picks
              </button>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">computeColumns</div>
            <div className="space-y-1">
              {(cfg as DerivedConfig).computeColumns.map((cc, i) => (
                <div key={i} className="space-y-1 border border-neutral-800 rounded p-2">
                  <input
                    value={cc.name}
                    placeholder="col name"
                    onChange={(e) => {
                      const cs = [...(cfg as DerivedConfig).computeColumns];
                      cs[i] = { ...cs[i], name: e.target.value };
                      update({ computeColumns: cs } as Partial<DerivedConfig>);
                    }}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                  />
                  <input
                    value={cc.formula}
                    placeholder="formula (e.g. row.price * 1.1)"
                    onChange={(e) => {
                      const cs = [...(cfg as DerivedConfig).computeColumns];
                      cs[i] = { ...cs[i], formula: e.target.value };
                      update({ computeColumns: cs } as Partial<DerivedConfig>);
                    }}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                  />
                  <button
                    onClick={() => {
                      const cs = (cfg as DerivedConfig).computeColumns.filter((_, j) => j !== i);
                      update({ computeColumns: cs } as Partial<DerivedConfig>);
                    }}
                    className="text-[11px] text-red-400 hover:text-red-300"
                  >
                    ✕ remove
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                update({
                  computeColumns: [
                    ...(cfg as DerivedConfig).computeColumns,
                    { name: 'new_col', formula: 'row.id' },
                  ],
                } as Partial<DerivedConfig>)
              }
              className="mt-1 text-xs text-sky-400 hover:text-sky-300"
            >
              + add compute column
            </button>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">rules (first-match-wins)</div>
            <div className="space-y-1">
              {(cfg as DerivedConfig).rules.map((r, i) => (
                <div key={i} className="space-y-1 border border-neutral-800 rounded p-2">
                  <input
                    value={r.when}
                    placeholder="when (predicate)"
                    onChange={(e) => {
                      const rs = [...(cfg as DerivedConfig).rules];
                      rs[i] = { ...rs[i], when: e.target.value };
                      update({ rules: rs } as Partial<DerivedConfig>);
                    }}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                  />
                  <input
                    value={r.then}
                    placeholder="then (value or object)"
                    onChange={(e) => {
                      const rs = [...(cfg as DerivedConfig).rules];
                      rs[i] = { ...rs[i], then: e.target.value };
                      update({ rules: rs } as Partial<DerivedConfig>);
                    }}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                  />
                  <button
                    onClick={() => {
                      const rs = (cfg as DerivedConfig).rules.filter((_, j) => j !== i);
                      update({ rules: rs } as Partial<DerivedConfig>);
                    }}
                    className="text-[11px] text-red-400 hover:text-red-300"
                  >
                    ✕ remove
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                update({
                  rules: [...(cfg as DerivedConfig).rules, { when: 'true', then: '({})' }],
                } as Partial<DerivedConfig>)
              }
              className="mt-1 text-xs text-sky-400 hover:text-sky-300"
            >
              + add rule
            </button>
          </div>
        </>
      )}

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
