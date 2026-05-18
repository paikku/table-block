import type {
  FlowDoc,
  FlowNode,
  ColumnDef,
  DynamicConfig,
  CrudConfig,
  DerivedConfig,
  InterceptorConfig,
  RowGenSpec,
  CellRule,
} from './types';

type Row = Record<string, unknown>;

export interface TableData {
  schema: ColumnDef[];
  rows: Row[];
  blocked?: boolean;
}
export interface LogEntry {
  nodeId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}
export interface RunResult {
  ok: boolean;
  logs: LogEntry[];
  tables: Record<string, TableData>;
}

function topoSort(
  nodes: FlowNode[],
  edges: { source: string; target: string }[],
): string[] | null {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.target) || !indeg.has(e.source)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const q: string[] = [];
  for (const [id, d] of indeg) if (d === 0) q.push(id);
  const out: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    out.push(id);
    for (const nx of adj.get(id) ?? []) {
      indeg.set(nx, indeg.get(nx)! - 1);
      if (indeg.get(nx) === 0) q.push(nx);
    }
  }
  return out.length === nodes.length ? out : null;
}

function mockRowsFromSchema(schema: ColumnDef[], count = 3): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const row: Row = {};
    for (const c of schema) {
      if (c.type === 'number') row[c.name] = i + 1;
      else if (c.type === 'boolean') row[c.name] = i % 2 === 0;
      else row[c.name] = `${c.name}-${i + 1}`;
    }
    return row;
  });
}

function safeEval(expr: string, ctx: Record<string, unknown>): unknown {
  const keys = Object.keys(ctx);
  const vals = Object.values(ctx);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function(...keys, `"use strict"; return (${expr});`);
  return fn(...vals);
}

// ── rowGen 평가 ─────────────────────────────────────────────────────────
//
// 각 항목: keyVals(키 컬럼 값들) + originNodeId(어디서 왔는지) + originRow(원본 행).
// Union 으로 dedupe 할 때 keyVals 의 JSON 직렬화로 비교.

interface RowSeed {
  keyVals: Record<string, unknown>;
  originNodeId?: string;
  originRow?: Row;
}

function evalRowGen(
  spec: RowGenSpec,
  tables: Record<string, TableData>,
  inputs: Record<string, TableData>,
): { seeds: RowSeed[]; keys: string[] } {
  if (spec.type === 'keysFrom') {
    const src = tables[spec.fromNodeId];
    if (!src) return { seeds: [], keys: spec.keys };
    const seeds: RowSeed[] = src.rows.map((r) => {
      const kv: Record<string, unknown> = {};
      for (const k of spec.keys) kv[k] = r[k];
      return { keyVals: kv, originNodeId: spec.fromNodeId, originRow: r };
    });
    return { seeds, keys: spec.keys };
  }
  if (spec.type === 'union') {
    const seen = new Set<string>();
    const seeds: RowSeed[] = [];
    let keys: string[] = [];
    for (const sub of spec.sources) {
      const r = evalRowGen(sub, tables, inputs);
      if (keys.length === 0) keys = r.keys;
      for (const s of r.seeds) {
        const sig = JSON.stringify(s.keyVals);
        if (seen.has(sig)) continue;
        seen.add(sig);
        seeds.push(s);
      }
    }
    return { seeds, keys };
  }
  // filter
  const inner = evalRowGen(spec.source, tables, inputs);
  const seeds = inner.seeds.filter((s) => {
    try {
      return !!safeEval(spec.predicate || 'true', { row: s.originRow ?? s.keyVals, key: s.keyVals, inputs });
    } catch {
      return false;
    }
  });
  return { seeds, keys: inner.keys };
}

// 단일 키 가정 — 양쪽에서 같은 컬럼명을 가진다.
function lookupRow(table: TableData, keyVals: Record<string, unknown>, keys: string[]): Row | undefined {
  return table.rows.find((r) => keys.every((k) => r[k] === keyVals[k]));
}

function deriveOutputSchema(cellRules: CellRule[]): ColumnDef[] {
  const out: ColumnDef[] = [];
  const seen = new Set<string>();
  for (const c of cellRules) {
    if (!c.name || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ name: c.name, type: 'string' });
  }
  return out;
}

export async function runFlow(doc: FlowDoc): Promise<RunResult> {
  const logs: LogEntry[] = [];
  const tables: Record<string, TableData> = {};

  const order = topoSort(doc.nodes, doc.edges);
  if (!order) {
    return {
      ok: false,
      logs: [{ nodeId: '*', level: 'error', message: 'cycle detected — DAG must be acyclic' }],
      tables,
    };
  }

  const incoming = new Map<string, string[]>();
  for (const n of doc.nodes) incoming.set(n.id, []);
  for (const e of doc.edges) incoming.get(e.target)?.push(e.source);

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));

  for (const id of order) {
    const node = byId.get(id)!;
    const cfg = node.config;
    const upstreamIds = incoming.get(id) ?? [];
    const upstreamBlocked = upstreamIds.some((uid) => tables[uid]?.blocked);

    if (upstreamBlocked) {
      logs.push({ nodeId: id, level: 'warn', message: 'skipped — upstream blocked' });
      tables[id] = { schema: [], rows: [], blocked: true };
      continue;
    }

    try {
      if (cfg.kind === 'dynamic') {
        const c = cfg as DynamicConfig;
        let rows: Row[];
        if (/^https?:/.test(c.fetchUrl)) {
          try {
            const res = await fetch(c.fetchUrl, { signal: AbortSignal.timeout(5000) });
            const j = await res.json();
            rows = Array.isArray(j)
              ? (j as Row[])
              : Array.isArray((j as { data?: Row[] }).data)
                ? (j as { data: Row[] }).data
                : [j as Row];
          } catch (e) {
            logs.push({ nodeId: id, level: 'warn', message: `fetch failed, using mock: ${(e as Error).message}` });
            rows = mockRowsFromSchema(c.schema);
          }
        } else {
          rows = mockRowsFromSchema(c.schema);
          logs.push({ nodeId: id, level: 'info', message: `mock fetch (${c.fetchUrl}) → ${rows.length} rows` });
        }
        tables[id] = { schema: c.schema, rows };
        logs.push({ nodeId: id, level: 'info', message: `[Dynamic] ${c.name}: ${rows.length} rows` });
      } else if (cfg.kind === 'crud') {
        const c = cfg as CrudConfig;
        let rows: Row[] = [];
        try {
          rows = JSON.parse(c.rowsJson) as Row[];
          if (!Array.isArray(rows)) rows = [];
        } catch {
          logs.push({ nodeId: id, level: 'warn', message: 'invalid rowsJson, treating as empty' });
        }
        tables[id] = { schema: c.schema, rows };
        logs.push({
          nodeId: id,
          level: 'info',
          message: `[CRUD] ${c.name}: ${rows.length} rows (history=${c.history}, audit=${c.audit})`,
        });
      } else if (cfg.kind === 'derived') {
        const c = cfg as DerivedConfig;

        const inputs: Record<string, TableData> = {};
        for (const uid of upstreamIds) {
          const un = byId.get(uid);
          if (un && tables[uid]) inputs[un.config.name] = tables[uid];
        }

        const { seeds, keys } = evalRowGen(c.rowGen, tables, inputs);
        const outSchema = deriveOutputSchema(c.cellRules);

        const outRows: Row[] = [];
        for (const seed of seeds) {
          const out: Row = {};
          for (const rule of c.cellRules) {
            if (rule.mode === 'pick') {
              // origin 노드와 일치하면 그대로
              if (rule.from === seed.originNodeId && seed.originRow) {
                out[rule.name] = seed.originRow[rule.col] ?? null;
              } else {
                const src = tables[rule.from];
                if (!src) {
                  out[rule.name] = null;
                } else {
                  const match = lookupRow(src, seed.keyVals, keys);
                  out[rule.name] = match ? match[rule.col] ?? null : null;
                }
              }
            } else if (rule.mode === 'formula') {
              try {
                out[rule.name] = safeEval(rule.formula || 'null', {
                  row: seed.originRow ?? seed.keyVals,
                  key: seed.keyVals,
                  out,
                  inputs,
                });
              } catch (e) {
                logs.push({
                  nodeId: id,
                  level: 'warn',
                  message: `cellRule(${rule.name}) formula error: ${(e as Error).message}`,
                });
                out[rule.name] = null;
              }
            } else {
              // cases (first-match-wins)
              const ctx = { row: seed.originRow ?? seed.keyVals, key: seed.keyVals, out, inputs };
              let v: unknown = null;
              try {
                v = safeEval(rule.default || 'null', ctx);
              } catch {
                v = null;
              }
              for (const cs of rule.cases) {
                let matched = false;
                try {
                  matched = !!safeEval(cs.when, ctx);
                } catch (e) {
                  logs.push({
                    nodeId: id,
                    level: 'warn',
                    message: `cellRule(${rule.name}).when error: ${(e as Error).message}`,
                  });
                }
                if (matched) {
                  try {
                    v = safeEval(cs.then, ctx);
                  } catch (e) {
                    logs.push({
                      nodeId: id,
                      level: 'warn',
                      message: `cellRule(${rule.name}).then error: ${(e as Error).message}`,
                    });
                  }
                  break;
                }
              }
              out[rule.name] = v;
            }
          }
          outRows.push(out);
        }

        tables[id] = { schema: outSchema, rows: outRows };
        logs.push({
          nodeId: id,
          level: 'info',
          message: `[Derived] ${c.name}: rowGen=${c.rowGen.type} → ${outRows.length} rows`,
        });
      } else if (cfg.kind === 'interceptor') {
        const c = cfg as InterceptorConfig;
        const src = tables[upstreamIds[0]];
        if (!src) {
          logs.push({ nodeId: id, level: 'error', message: 'no input table' });
          tables[id] = { schema: [], rows: [] };
          continue;
        }
        if (c.mode === 'pass') {
          tables[id] = { schema: src.schema, rows: src.rows };
          logs.push({ nodeId: id, level: 'info', message: `[Interceptor:pass] ${c.name} effect="${c.effect}"` });
        } else if (c.mode === 'block-on-fail') {
          let ok = true;
          for (const row of src.rows) {
            try {
              if (!safeEval(c.guard || 'true', { row })) {
                ok = false;
                break;
              }
            } catch {
              ok = false;
              break;
            }
          }
          if (ok) {
            tables[id] = { schema: src.schema, rows: src.rows };
            logs.push({ nodeId: id, level: 'info', message: `[Interceptor:block-on-fail] ${c.name} passed` });
          } else {
            tables[id] = { schema: src.schema, rows: [], blocked: true };
            logs.push({ nodeId: id, level: 'error', message: `[Interceptor:block-on-fail] ${c.name} BLOCKED downstream` });
          }
        } else {
          const filtered = src.rows.filter((row) => {
            try {
              return !!safeEval(c.guard || 'true', { row });
            } catch {
              return false;
            }
          });
          tables[id] = { schema: src.schema, rows: filtered };
          logs.push({
            nodeId: id,
            level: 'info',
            message: `[Interceptor:filter] ${c.name} ${src.rows.length} → ${filtered.length}`,
          });
        }
      }
    } catch (e) {
      logs.push({ nodeId: id, level: 'error', message: `node failure: ${(e as Error).message}` });
      tables[id] = { schema: [], rows: [] };
    }
  }

  return { ok: true, logs, tables };
}
