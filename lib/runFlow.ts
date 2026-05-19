import type {
  FlowDoc,
  FlowNode,
  ColumnDef,
  DynamicConfig,
  CrudConfig,
  DerivedConfig,
  InterceptorConfig,
  RowGen,
  GenerateRange,
  GenerateCalendar,
  GenerateRecursion,
} from './types';
import { normalizePicks, normalizeComputes } from './types';

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

// 행 층 평가. rowGen 미지정 시 primary rows 그대로 반환 (legacy).
export interface RowGenResult {
  rows: Row[];
  schema: ColumnDef[];       // rowGen 으로 인해 알려진 컬럼들 (key/generate 컬럼)
  warnings: string[];
}

// ${node.col} → inputs[node].rows[0][col] (Dynamic fetchUrl 과 동일 메커니즘).
// 변수 자리 (rowGen Generate args, Interceptor effect) 에서 공용으로 사용.
function interpolateVarRefs(s: string, inputs: Record<string, TableData>): string {
  return s.replace(/\$\{([^.}\s]+)\.([^}\s]+)\}/g, (m, name, col) => {
    const v = inputs[name]?.rows[0]?.[col];
    return v === undefined || v === null ? m : String(v);
  });
}

function evalGenerate(
  spec: GenerateRange | GenerateCalendar | GenerateRecursion,
  inputs: Record<string, TableData>,
): { rows: Row[]; column: string; type: ColumnDef['type'] } {
  if (spec.kind === 'range') {
    const rows: Row[] = [];
    const step = spec.step || 1;
    if (step > 0) {
      for (let v = spec.from; v < spec.to; v += step) {
        rows.push({ [spec.column]: v });
        if (rows.length > 10000) break;
      }
    } else {
      for (let v = spec.from; v > spec.to; v += step) {
        rows.push({ [spec.column]: v });
        if (rows.length > 10000) break;
      }
    }
    return { rows, column: spec.column, type: 'number' };
  }
  if (spec.kind === 'calendar') {
    const rows: Row[] = [];
    const start = new Date(interpolateVarRefs(spec.start, inputs) + 'T00:00:00Z');
    const end = new Date(interpolateVarRefs(spec.end, inputs) + 'T00:00:00Z');
    const stepMs = Math.max(1, spec.stepDays) * 24 * 60 * 60 * 1000;
    for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
      rows.push({ [spec.column]: new Date(t).toISOString().slice(0, 10) });
      if (rows.length > 10000) break;
    }
    return { rows, column: spec.column, type: 'string' };
  }
  // recursion
  const rows: Row[] = [];
  let prev: unknown;
  try {
    prev = safeEval(spec.seedExpr || 'null', {});
  } catch {
    return { rows, column: spec.column, type: 'string' };
  }
  const max = Math.max(1, Math.min(spec.maxRows || 100, 10000));
  for (let i = 0; i < max; i++) {
    let cont = false;
    try {
      cont = !!safeEval(spec.whileExpr || 'false', { ctx: { prev, i } });
    } catch {
      cont = false;
    }
    if (!cont) break;
    rows.push({ [spec.column]: prev });
    try {
      prev = safeEval(spec.nextExpr || 'ctx.prev', { ctx: { prev, i } });
    } catch {
      break;
    }
  }
  return { rows, column: spec.column, type: 'string' };
}

export function evalRowGen(
  rg: RowGen | undefined,
  filterPredicate: string | undefined,
  primary: TableData | undefined,
  inputByNodeId: Record<string, TableData>,
  inputs: Record<string, TableData> = {},
): RowGenResult {
  const warnings: string[] = [];
  let rows: Row[] = [];
  let schema: ColumnDef[] = [];

  if (!rg) {
    rows = primary ? [...primary.rows] : [];
    schema = primary ? [...primary.schema] : [];
  } else if (rg.kind === 'keys-from') {
    const src = inputByNodeId[rg.sourceNodeId];
    if (!src) {
      warnings.push(`keys-from: source "${rg.sourceNodeId}" not in upstream`);
    } else {
      const cols = rg.keyColumns.length > 0
        ? rg.keyColumns
        : src.schema.map((s) => s.name);
      const seen = new Set<string>();
      const out: Row[] = [];
      for (const r of src.rows) {
        const k: Row = {};
        for (const c of cols) k[c] = r[c];
        const sig = JSON.stringify(k);
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(k);
      }
      rows = out;
      schema = cols.map((c) => {
        const sc = src.schema.find((s) => s.name === c);
        return { name: c, type: sc?.type ?? 'string' };
      });
    }
  } else if (rg.kind === 'union') {
    const seen = new Set<string>();
    const out: Row[] = [];
    const allCols = new Map<string, ColumnDef['type']>();
    for (const part of rg.parts) {
      const src = inputByNodeId[part.sourceNodeId];
      if (!src) {
        warnings.push(`union: source "${part.sourceNodeId}" not in upstream`);
        continue;
      }
      const cols = part.keyColumns.length > 0 ? part.keyColumns : src.schema.map((s) => s.name);
      for (const c of cols) {
        if (!allCols.has(c)) {
          const sc = src.schema.find((s) => s.name === c);
          allCols.set(c, sc?.type ?? 'string');
        }
      }
      for (const r of src.rows) {
        const k: Row = {};
        for (const c of cols) k[c] = r[c];
        const sig = JSON.stringify(k);
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(k);
      }
    }
    rows = out;
    schema = [...allCols.entries()].map(([name, type]) => ({ name, type }));
  } else if (rg.kind === 'product') {
    const sources = rg.parts.map((p) => ({ id: p.sourceNodeId, t: inputByNodeId[p.sourceNodeId] }));
    if (sources.some((s) => !s.t)) {
      warnings.push('product: 일부 source 가 upstream 에 없음');
    }
    const valid = sources.filter((s) => !!s.t) as { id: string; t: TableData }[];
    if (valid.length === 0) {
      rows = [];
    } else {
      // accumulate: 시작은 첫 번째 테이블의 row, 이후 각 추가 source 에 대해 join/cartesian
      let acc: Row[] = valid[0].t.rows.map((r) => ({ ...r }));
      const colTypes = new Map<string, ColumnDef['type']>();
      for (const sc of valid[0].t.schema) colTypes.set(sc.name, sc.type);
      for (let i = 1; i < valid.length; i++) {
        const next = valid[i].t;
        for (const sc of next.schema) if (!colTypes.has(sc.name)) colTypes.set(sc.name, sc.type);
        const merged: Row[] = [];
        for (const a of acc) {
          for (const b of next.rows) {
            if (rg.joinKeys.length > 0) {
              let ok = true;
              for (const k of rg.joinKeys) {
                if (k in a && k in b && a[k] !== b[k]) { ok = false; break; }
              }
              if (!ok) continue;
            }
            merged.push({ ...a, ...b });
            if (merged.length > 10000) break;
          }
          if (merged.length > 10000) break;
        }
        acc = merged;
      }
      rows = acc;
      schema = [...colTypes.entries()].map(([name, type]) => ({ name, type }));
    }
  } else if (rg.kind === 'generate') {
    const g = evalGenerate(rg.spec, inputs);
    rows = g.rows;
    schema = [{ name: g.column, type: g.type }];
  }

  if (filterPredicate && filterPredicate.trim()) {
    const before = rows.length;
    rows = rows.filter((row) => {
      try {
        return !!safeEval(filterPredicate, { row, inputs });
      } catch {
        return false;
      }
    });
    if (rows.length !== before) {
      warnings.push(`filter: ${before} → ${rows.length} rows`);
    }
  }

  return { rows, schema, warnings };
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
        const inputs: Record<string, TableData> = {};
        for (const uid of upstreamIds) {
          const un = byId.get(uid);
          if (un && tables[uid]) inputs[un.config.name] = tables[uid];
        }
        const url = interpolateVarRefs(c.fetchUrl, inputs);
        let rows: Row[];
        if (/^https?:/.test(url)) {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            const j = await res.json();
            rows = Array.isArray(j) ? (j as Row[]) : Array.isArray((j as { data?: Row[] }).data) ? (j as { data: Row[] }).data : [j as Row];
          } catch (e) {
            logs.push({ nodeId: id, level: 'warn', message: `fetch failed, using mock: ${(e as Error).message}` });
            rows = mockRowsFromSchema(c.schema);
          }
        } else {
          rows = mockRowsFromSchema(c.schema);
          logs.push({ nodeId: id, level: 'info', message: `mock fetch (${url}) → ${rows.length} rows` });
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
        logs.push({ nodeId: id, level: 'info', message: `[CRUD] ${c.name}: ${rows.length} rows (history=${c.history}, audit=${c.audit})` });
      } else if (cfg.kind === 'derived') {
        const c = cfg as DerivedConfig;
        const picks = normalizePicks(c.pickColumns as unknown);
        const computes = normalizeComputes(c.computeColumns as unknown);
        const inputJoins = Array.isArray(c.inputJoins) ? c.inputJoins : [];

        const inputs: Record<string, TableData> = {};
        const inputByNodeId: Record<string, TableData> = {};
        for (const uid of upstreamIds) {
          const un = byId.get(uid);
          if (un && tables[uid]) {
            inputs[un.config.name] = tables[uid];
            inputByNodeId[uid] = tables[uid];
          }
        }
        const primaryId = c.primaryNodeId || upstreamIds[0];
        const primary = tables[primaryId];

        // 행 층: rowGen 평가 (Filter 술어, Generate 인자에서 변수 참조 가능)
        const rowGenRes = evalRowGen(c.rowGen, c.rowGenFilter, primary, inputByNodeId, inputs);
        for (const w of rowGenRes.warnings) {
          logs.push({ nodeId: id, level: 'warn', message: `rowGen: ${w}` });
        }
        const baseRows = rowGenRes.rows;
        const baseSchema = rowGenRes.schema;

        // primary 가 없고 rowGen 도 없으면 (legacy 경로) 에러로 처리
        if (!c.rowGen && !primary) {
          logs.push({ nodeId: id, level: 'error', message: 'no primary input table (rowGen 미지정 시 primary 필수)' });
          tables[id] = { schema: [], rows: [] };
          continue;
        }

        const isPrimary = (from: string) => from === 'primary' || from === primaryId;

        const autoKey = (a: ColumnDef[], b: ColumnDef[]): string => {
          const bs = new Set(b.map((s) => s.name));
          for (const x of a) if (bs.has(x.name)) return x.name;
          return '';
        };

        // 출력 스키마: baseSchema (행 층 컬럼) → picks → computes 순서로 누적
        const outSchema: ColumnDef[] = [];
        const seen = new Set<string>();
        for (const sc of baseSchema) {
          if (!seen.has(sc.name)) {
            outSchema.push({ name: sc.name, type: sc.type });
            seen.add(sc.name);
          }
        }
        for (const pe of picks) {
          // rowGen 사용 중이면 'primary' 대신 명시된 source 가 우선. 단 legacy 호환 위해 isPrimary 로직 유지.
          const src = isPrimary(pe.from) ? (primary ?? undefined) : inputByNodeId[pe.from];
          if (!src) {
            if (!seen.has(pe.col)) { outSchema.push({ name: pe.col, type: 'string' }); seen.add(pe.col); }
            continue;
          }
          const col = src.schema.find((s) => s.name === pe.col);
          if (col && !seen.has(col.name)) {
            outSchema.push({ name: col.name, type: col.type });
            seen.add(col.name);
          }
        }
        for (const cc of computes) {
          if (!seen.has(cc.name)) {
            outSchema.push({ name: cc.name, type: 'string' });
            seen.add(cc.name);
          }
        }

        const outRows: Row[] = [];
        for (const row of baseRows) {
          const out: Row = {};
          // base rowGen 이 만든 컬럼들도 out 으로 전파
          for (const sc of baseSchema) out[sc.name] = row[sc.name];
          for (const pe of picks) {
            if (isPrimary(pe.from)) {
              if (pe.col in row) {
                out[pe.col] = row[pe.col];
              } else if (primary) {
                // rowGen 사용 중: primary 에서 lookup
                const join = inputJoins.find((j) => j.fromNodeId === primaryId);
                const key = join?.key || (baseSchema[0]?.name ?? '');
                if (key && key in row) {
                  const match = primary.rows.find((r) => r[key] === row[key]);
                  out[pe.col] = match ? match[pe.col] ?? null : null;
                } else {
                  out[pe.col] = null;
                }
              } else {
                out[pe.col] = null;
              }
            } else {
              const srcTable = inputByNodeId[pe.from];
              if (!srcTable) { out[pe.col] = null; continue; }
              const join = inputJoins.find((j) => j.fromNodeId === pe.from);
              const key = join?.key
                || autoKey(primary?.schema ?? baseSchema, srcTable.schema);
              if (!key) { out[pe.col] = null; continue; }
              const match = srcTable.rows.find((r) => r[key] === row[key]);
              out[pe.col] = match ? match[pe.col] ?? null : null;
            }
          }
          for (const cc of computes) {
            const ctx = { row, out, inputs };
            try {
              if (cc.mode === 'cases') {
                let v: unknown = safeEval(cc.default || 'null', ctx);
                for (const cs of cc.cases) {
                  let matched = false;
                  try { matched = !!safeEval(cs.when, ctx); }
                  catch (e) {
                    logs.push({ nodeId: id, level: 'warn', message: `compute(${cc.name}).when error: ${(e as Error).message}` });
                  }
                  if (matched) {
                    v = safeEval(cs.then, ctx);
                    break;
                  }
                }
                out[cc.name] = v;
              } else {
                out[cc.name] = safeEval(cc.formula, ctx);
              }
            } catch (e) {
              logs.push({ nodeId: id, level: 'warn', message: `compute(${cc.name}) failed: ${(e as Error).message}` });
              out[cc.name] = null;
            }
          }
          outRows.push(out);
        }
        tables[id] = { schema: outSchema, rows: outRows };
        logs.push({ nodeId: id, level: 'info', message: `[Derived] ${c.name}: ${outRows.length} rows` });
      } else if (cfg.kind === 'interceptor') {
        const c = cfg as InterceptorConfig;
        // deps[]: 첫 upstream = 데이터 흐름 (row context), 나머지 = inputs 로 노출 (변수 참조).
        const src = tables[upstreamIds[0]];
        const inputs: Record<string, TableData> = {};
        for (const uid of upstreamIds) {
          const un = byId.get(uid);
          if (un && tables[uid]) inputs[un.config.name] = tables[uid];
        }
        if (!src) {
          logs.push({ nodeId: id, level: 'error', message: 'no input table' });
          tables[id] = { schema: [], rows: [] };
          continue;
        }
        const effectStr = interpolateVarRefs(c.effect, inputs);
        if (c.mode === 'pass') {
          tables[id] = { schema: src.schema, rows: src.rows };
          logs.push({ nodeId: id, level: 'info', message: `[Interceptor:pass] ${c.name} effect="${effectStr}"` });
        } else if (c.mode === 'block-on-fail') {
          let ok = true;
          for (const row of src.rows) {
            try {
              if (!safeEval(c.guard || 'true', { row, inputs })) {
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
            logs.push({ nodeId: id, level: 'info', message: `[Interceptor:block-on-fail] ${c.name} passed effect="${effectStr}"` });
          } else {
            tables[id] = { schema: src.schema, rows: [], blocked: true };
            logs.push({ nodeId: id, level: 'error', message: `[Interceptor:block-on-fail] ${c.name} BLOCKED downstream effect="${effectStr}"` });
          }
        } else {
          const filtered = src.rows.filter((row) => {
            try {
              return !!safeEval(c.guard || 'true', { row, inputs });
            } catch {
              return false;
            }
          });
          tables[id] = { schema: src.schema, rows: filtered };
          logs.push({ nodeId: id, level: 'info', message: `[Interceptor:filter] ${c.name} ${src.rows.length} → ${filtered.length} effect="${effectStr}"` });
        }
      }
    } catch (e) {
      logs.push({ nodeId: id, level: 'error', message: `node failure: ${(e as Error).message}` });
      tables[id] = { schema: [], rows: [] };
    }
  }

  return { ok: true, logs, tables };
}
