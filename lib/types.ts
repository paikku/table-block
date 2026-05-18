export type NodeKind = 'dynamic' | 'crud' | 'derived' | 'interceptor';

export interface ColumnDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
}

export interface DynamicConfig {
  kind: 'dynamic';
  name: string;
  schema: ColumnDef[];
  fetchUrl: string;
  params: Record<string, string>;
  cacheTtlSec: number;
}

export interface CrudConfig {
  kind: 'crud';
  name: string;
  schema: ColumnDef[];
  rowsJson: string;
  history: boolean;
  audit: boolean;
}

// ── Derived: 행 층 (rowGen) ────────────────────────────────────────────
//
// MVP 범위: KeysFrom / Union / Filter 까지만.
// Product, Generate 는 docs/mvp.md 의 후순위 항목.

export interface KeysFromSpec {
  type: 'keysFrom';
  fromNodeId: string;      // incoming 노드 id
  keys: string[];          // 키 컬럼명 (MVP: 단일 키 가정 — 양쪽 동일 이름)
}
export interface UnionSpec {
  type: 'union';
  sources: RowGenSpec[];
}
export interface FilterSpec {
  type: 'filter';
  source: RowGenSpec;
  predicate: string;       // safeEval(row, inputs) — true 인 행만
}
export type RowGenSpec = KeysFromSpec | UnionSpec | FilterSpec;

// ── Derived: 셀 층 (cellRules) ──────────────────────────────────────────
//
// 한 entry = 한 출력 컬럼. mode 로 pick / formula / cases 분기.
// 구버전 pickColumns/computeColumns 는 normalize 단계에서 모두 cellRules 로 흡수.

export interface CellPick {
  name: string;
  mode: 'pick';
  from: string;            // node id (KeysFrom 의 fromNodeId 와 같으면 origin row 에서 직접)
  col: string;
}
export interface CellFormula {
  name: string;
  mode: 'formula';
  formula: string;
}
export interface CellCases {
  name: string;
  mode: 'cases';
  cases: { when: string; then: string }[];
  default: string;
}
export type CellRule = CellPick | CellFormula | CellCases;

export interface DerivedConfig {
  kind: 'derived';
  name: string;
  rowGen: RowGenSpec;
  cellRules: CellRule[];
}

// ── Interceptor ─────────────────────────────────────────────────────────

export type InterceptorMode = 'pass' | 'block-on-fail' | 'filter';
export interface InterceptorConfig {
  kind: 'interceptor';
  name: string;
  mode: InterceptorMode;
  guard: string;
  effect: string;
}

export type NodeConfig =
  | DynamicConfig
  | CrudConfig
  | DerivedConfig
  | InterceptorConfig;

export interface FlowNode {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  config: NodeConfig;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowDoc {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ── Defaults ────────────────────────────────────────────────────────────

export function defaultRowGen(): RowGenSpec {
  return { type: 'keysFrom', fromNodeId: '', keys: ['id'] };
}

export function defaultConfig(kind: NodeKind, name: string): NodeConfig {
  switch (kind) {
    case 'dynamic':
      return {
        kind: 'dynamic',
        name,
        schema: [
          { name: 'id', type: 'number' },
          { name: 'value', type: 'string' },
        ],
        fetchUrl: 'mock://sample',
        params: {},
        cacheTtlSec: 60,
      };
    case 'crud':
      return {
        kind: 'crud',
        name,
        schema: [
          { name: 'id', type: 'number' },
          { name: 'label', type: 'string' },
        ],
        rowsJson: JSON.stringify(
          [
            { id: 1, label: 'first' },
            { id: 2, label: 'second' },
          ],
          null,
          2,
        ),
        history: true,
        audit: false,
      };
    case 'derived':
      return {
        kind: 'derived',
        name,
        rowGen: defaultRowGen(),
        cellRules: [],
      };
    case 'interceptor':
      return {
        kind: 'interceptor',
        name,
        mode: 'pass',
        guard: 'true',
        effect: 'log:passed',
      };
  }
}

// ── Legacy normalization ────────────────────────────────────────────────
//
// 구버전 Derived 모양:
//   { primaryNodeId, inputJoins[], pickColumns: PickEntry[], computeColumns: ComputeColumn[] }
// 신버전:
//   { rowGen: KeysFrom(primary, [autoKey]), cellRules: [...] }
//
// 변환 규칙:
//   - primaryNodeId  → rowGen.keysFrom.fromNodeId
//   - inputJoins 의 첫 key, 또는 'id' 를 단일 키로 채택 (MVP 가정)
//   - pickColumns    → cellRules { mode:'pick', from, col, name=col }
//   - computeColumns → cellRules { mode:'formula'|'cases', ... }
//   - 'primary' alias 는 fromNodeId 로 치환

function legacyDerivedToNew(raw: unknown): DerivedConfig {
  const c = (raw ?? {}) as Record<string, unknown>;
  const name = String(c.name ?? '');

  // 이미 신모델
  if (c.rowGen && Array.isArray(c.cellRules)) {
    return {
      kind: 'derived',
      name,
      rowGen: normalizeRowGen(c.rowGen),
      cellRules: normalizeCellRules(c.cellRules),
    };
  }

  // 구모델 → 신모델
  const primaryNodeId = String(c.primaryNodeId ?? '');
  const inputJoins = Array.isArray(c.inputJoins) ? (c.inputJoins as Array<{ key?: string }>) : [];
  const guessKey = inputJoins[0]?.key ?? 'id';

  const picks: CellRule[] = Array.isArray(c.pickColumns)
    ? (c.pickColumns as Array<{ from?: string; col?: string } | string>).map((p) => {
        if (typeof p === 'string') {
          return { name: p, mode: 'pick', from: primaryNodeId, col: p };
        }
        const from = p?.from === 'primary' || !p?.from ? primaryNodeId : p.from;
        const col = p?.col ?? '';
        return { name: col, mode: 'pick', from, col };
      })
    : [];

  const computes: CellRule[] = Array.isArray(c.computeColumns)
    ? (c.computeColumns as Array<Record<string, unknown>>).map((cc) => {
        const ccName = String(cc.name ?? '');
        if (cc.mode === 'cases') {
          return {
            name: ccName,
            mode: 'cases',
            cases: Array.isArray(cc.cases) ? (cc.cases as { when: string; then: string }[]) : [],
            default: String(cc.default ?? 'null'),
          };
        }
        return { name: ccName, mode: 'formula', formula: String(cc.formula ?? '') };
      })
    : [];

  return {
    kind: 'derived',
    name,
    rowGen: { type: 'keysFrom', fromNodeId: primaryNodeId, keys: [guessKey] },
    cellRules: [...picks, ...computes],
  };
}

function normalizeRowGen(raw: unknown): RowGenSpec {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.type === 'union' && Array.isArray(r.sources)) {
    return { type: 'union', sources: (r.sources as unknown[]).map(normalizeRowGen) };
  }
  if (r.type === 'filter' && r.source) {
    return {
      type: 'filter',
      source: normalizeRowGen(r.source),
      predicate: String(r.predicate ?? 'true'),
    };
  }
  // default to keysFrom
  return {
    type: 'keysFrom',
    fromNodeId: String(r.fromNodeId ?? ''),
    keys: Array.isArray(r.keys) && r.keys.length > 0 ? (r.keys as string[]) : ['id'],
  };
}

function normalizeCellRules(raw: unknown): CellRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const cc = (c ?? {}) as Record<string, unknown>;
    const name = String(cc.name ?? '');
    if (cc.mode === 'pick') {
      return { name, mode: 'pick', from: String(cc.from ?? ''), col: String(cc.col ?? name) };
    }
    if (cc.mode === 'cases') {
      return {
        name,
        mode: 'cases',
        cases: Array.isArray(cc.cases) ? (cc.cases as { when: string; then: string }[]) : [],
        default: String(cc.default ?? 'null'),
      };
    }
    return { name, mode: 'formula', formula: String(cc.formula ?? '') };
  });
}

export function normalizeNodeConfig(cfg: NodeConfig): NodeConfig {
  if (cfg.kind === 'derived') return legacyDerivedToNew(cfg);
  return cfg;
}
