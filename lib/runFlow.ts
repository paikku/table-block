import type {
  FlowDoc,
  FlowNode,
  ColumnDef,
  DynamicConfig,
  CrudConfig,
  DerivedConfig,
  InterceptorConfig,
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
        const url = c.fetchUrl.replace(/\$\{([^.}\s]+)\.([^}\s]+)\}/g, (m, name, col) => {
          const v = inputs[name]?.rows[0]?.[col];
          return v === undefined || v === null ? m : String(v);
        });
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
        if (!primary) {
          logs.push({ nodeId: id, level: 'error', message: 'no primary input table' });
          tables[id] = { schema: [], rows: [] };
          continue;
        }

        const isPrimary = (from: string) => from === 'primary' || from === primaryId;

        const autoKey = (a: ColumnDef[], b: ColumnDef[]): string => {
          const bs = new Set(b.map((s) => s.name));
          for (const x of a) if (bs.has(x.name)) return x.name;
          return '';
        };

        const outSchema: ColumnDef[] = [];
        const seen = new Set<string>();
        for (const pe of picks) {
          const src = isPrimary(pe.from) ? primary : inputByNodeId[pe.from];
          if (!src) continue;
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
        for (const row of primary.rows) {
          const out: Row = {};
          for (const pe of picks) {
            if (isPrimary(pe.from)) {
              out[pe.col] = row[pe.col];
            } else {
              const srcTable = inputByNodeId[pe.from];
              if (!srcTable) { out[pe.col] = null; continue; }
              const join = inputJoins.find((j) => j.fromNodeId === pe.from);
              const key = join?.key || autoKey(primary.schema, srcTable.schema);
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
          logs.push({ nodeId: id, level: 'info', message: `[Interceptor:filter] ${c.name} ${src.rows.length} → ${filtered.length}` });
        }
      }
    } catch (e) {
      logs.push({ nodeId: id, level: 'error', message: `node failure: ${(e as Error).message}` });
      tables[id] = { schema: [], rows: [] };
    }
  }

  return { ok: true, logs, tables };
}
