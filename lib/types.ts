export type NodeKind = 'dynamic' | 'crud' | 'derived' | 'interceptor';

export interface ColumnDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
}

export interface DynamicConfig {
  kind: 'dynamic';
  name: string;
  schema: ColumnDef[];
  fetchUrl: string;            // http(s)://... 또는 mock
  params: Record<string, string>;
  cacheTtlSec: number;
}

export interface CrudConfig {
  kind: 'crud';
  name: string;
  schema: ColumnDef[];
  rowsJson: string;            // JSON 문자열로 보관 (UI 편집 용이)
  history: boolean;
  audit: boolean;
}

export interface InputJoin {
  fromNodeId: string;          // primary 가 아닌 incoming 노드의 id
  key: string;                 // 양쪽에 공통으로 존재하는 컬럼명 (v1: 양쪽 동일)
}

export interface PickEntry {
  from: string;                // 'primary' 또는 다른 incoming 노드의 id
  col: string;
}

export interface ComputeFormula {
  name: string;
  mode?: 'formula';
  formula: string;
}

export interface ComputeCases {
  name: string;
  mode: 'cases';
  cases: { when: string; then: string }[];
  default: string;
}

export type ComputeColumn = ComputeFormula | ComputeCases;

// ── rowGen ──────────────────────────────────────────────────────────────
// 행 층 (어떤 행들이 존재하나). 셀 층(pickColumns/computeColumns)은 행마다 평가.
// rowGen 이 없으면 legacy 동작: primary 의 모든 row 를 그대로 사용.

// *Expr 필드(선택)는 변수 셀 참조 등 표현식으로 정적값을 덮어쓴다 (V-0009).
// 예: fromExpr = 'inputs.globals.rows[0].period_start'
export interface GenerateRange {
  kind: 'range';
  column: string;
  from: number;
  to: number;
  step: number;
  fromExpr?: string;
  toExpr?: string;
  stepExpr?: string;
}
export interface GenerateCalendar {
  kind: 'calendar';
  column: string;
  start: string;      // ISO date (YYYY-MM-DD)
  end: string;        // ISO date inclusive
  stepDays: number;
  startExpr?: string;
  endExpr?: string;
  stepDaysExpr?: string;
}
export interface GenerateRecursion {
  kind: 'recursion';
  column: string;
  seedExpr: string;   // 초기값 JS expression (inputs 참조 가능)
  nextExpr: string;   // prev → next, ctx.prev 사용 가능
  whileExpr: string;  // ctx.prev 가 truthy 인 동안 진행 ('true' 면 maxRows 까지)
  maxRows: number;
}
export type GenerateSpec = GenerateRange | GenerateCalendar | GenerateRecursion;

export interface RowGenKeysFrom {
  kind: 'keys-from';
  sourceNodeId: string;
  keyColumns: string[];           // 비우면 source schema 전체 컬럼
}
export interface RowGenUnion {
  kind: 'union';
  parts: { sourceNodeId: string; keyColumns: string[] }[];
}
export interface RowGenProduct {
  kind: 'product';
  parts: { sourceNodeId: string }[];
  joinKeys: string[];             // 비우면 cartesian, 아니면 양쪽에 모두 존재하는 컬럼으로 inner-join
}
export interface RowGenGenerate {
  kind: 'generate';
  spec: GenerateSpec;
}
export type RowGen = RowGenKeysFrom | RowGenUnion | RowGenProduct | RowGenGenerate;

export interface DerivedConfig {
  kind: 'derived';
  name: string;
  // 행 층
  rowGen?: RowGen;                // 없으면 legacy: primary 의 row 그대로
  rowGenFilter?: string;          // base rowGen 결과에 적용되는 술어 (Filter 변형)
  // 셀 층 입력
  primaryNodeId: string;
  inputJoins: InputJoin[];
  pickColumns: PickEntry[];
  computeColumns: ComputeColumn[];
}

export type InterceptorMode = 'pass' | 'block-on-fail' | 'filter';
export interface InterceptorConfig {
  kind: 'interceptor';
  name: string;
  mode: InterceptorMode;
  guard: string;               // predicate; row 컨텍스트 사용
  effect: string;              // 설명 문자열 (mail:..., webhook:..., log:...)
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
        primaryNodeId: '',
        inputJoins: [],
        pickColumns: [],
        computeColumns: [],
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

// ── Legacy normalization ──
// Old shape: pickColumns: string[], computeColumns: { name, formula }[]
// New shape: pickColumns: PickEntry[], computeColumns: ComputeColumn[] (mode optional, default 'formula')
// loadFlow 시점에 한 번 통과시켜 두면 UI/runFlow 모두 새 모양만 알면 됨.

export function normalizePicks(raw: unknown): PickEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    if (typeof p === 'string') return { from: 'primary', col: p };
    const pe = p as Partial<PickEntry>;
    return { from: pe.from ?? 'primary', col: pe.col ?? '' };
  });
}

export function normalizeComputes(raw: unknown): ComputeColumn[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const cc = (c ?? {}) as {
      name?: string;
      mode?: 'formula' | 'cases';
      formula?: string;
      cases?: { when: string; then: string }[];
      default?: string;
    };
    if (cc.mode === 'cases') {
      return {
        name: cc.name ?? '',
        mode: 'cases',
        cases: Array.isArray(cc.cases) ? cc.cases : [],
        default: cc.default ?? 'null',
      };
    }
    return { name: cc.name ?? '', mode: 'formula', formula: cc.formula ?? '' };
  });
}

function normalizeRowGen(raw: unknown): RowGen | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { kind?: string };
  if (r.kind === 'keys-from') {
    const x = raw as Partial<RowGenKeysFrom>;
    return {
      kind: 'keys-from',
      sourceNodeId: x.sourceNodeId ?? '',
      keyColumns: Array.isArray(x.keyColumns) ? x.keyColumns.filter((s) => typeof s === 'string') : [],
    };
  }
  if (r.kind === 'union') {
    const x = raw as Partial<RowGenUnion>;
    return {
      kind: 'union',
      parts: Array.isArray(x.parts)
        ? x.parts.map((p) => ({
            sourceNodeId: typeof p?.sourceNodeId === 'string' ? p.sourceNodeId : '',
            keyColumns: Array.isArray(p?.keyColumns) ? p.keyColumns.filter((s) => typeof s === 'string') : [],
          }))
        : [],
    };
  }
  if (r.kind === 'product') {
    const x = raw as Partial<RowGenProduct>;
    return {
      kind: 'product',
      parts: Array.isArray(x.parts)
        ? x.parts.map((p) => ({ sourceNodeId: typeof p?.sourceNodeId === 'string' ? p.sourceNodeId : '' }))
        : [],
      joinKeys: Array.isArray(x.joinKeys) ? x.joinKeys.filter((s) => typeof s === 'string') : [],
    };
  }
  if (r.kind === 'generate') {
    const x = raw as Partial<RowGenGenerate>;
    const s = x.spec as Partial<GenerateSpec> | undefined;
    if (!s || typeof s !== 'object') return undefined;
    if (s.kind === 'range') {
      const rs = s as Partial<GenerateRange>;
      return {
        kind: 'generate',
        spec: {
          kind: 'range',
          column: rs.column ?? 'i',
          from: typeof rs.from === 'number' ? rs.from : 0,
          to: typeof rs.to === 'number' ? rs.to : 10,
          step: typeof rs.step === 'number' && rs.step !== 0 ? rs.step : 1,
          fromExpr: typeof rs.fromExpr === 'string' ? rs.fromExpr : undefined,
          toExpr: typeof rs.toExpr === 'string' ? rs.toExpr : undefined,
          stepExpr: typeof rs.stepExpr === 'string' ? rs.stepExpr : undefined,
        },
      };
    }
    if (s.kind === 'calendar') {
      const cs = s as Partial<GenerateCalendar>;
      return {
        kind: 'generate',
        spec: {
          kind: 'calendar',
          column: cs.column ?? 'date',
          start: cs.start ?? '2025-01-01',
          end: cs.end ?? '2025-01-07',
          stepDays: typeof cs.stepDays === 'number' && cs.stepDays > 0 ? cs.stepDays : 1,
          startExpr: typeof cs.startExpr === 'string' ? cs.startExpr : undefined,
          endExpr: typeof cs.endExpr === 'string' ? cs.endExpr : undefined,
          stepDaysExpr: typeof cs.stepDaysExpr === 'string' ? cs.stepDaysExpr : undefined,
        },
      };
    }
    if (s.kind === 'recursion') {
      const rc = s as Partial<GenerateRecursion>;
      return {
        kind: 'generate',
        spec: {
          kind: 'recursion',
          column: rc.column ?? 'n',
          seedExpr: rc.seedExpr ?? '1',
          nextExpr: rc.nextExpr ?? 'ctx.prev + 1',
          whileExpr: rc.whileExpr ?? 'ctx.prev < 10',
          maxRows: typeof rc.maxRows === 'number' && rc.maxRows > 0 ? rc.maxRows : 100,
        },
      };
    }
    return undefined;
  }
  return undefined;
}

export function normalizeNodeConfig(cfg: NodeConfig): NodeConfig {
  if (cfg.kind !== 'derived') return cfg;
  // legacy rules 필드가 있어도 무시 (DerivedConfig 에서 제거됨).
  const { ...rest } = cfg as DerivedConfig & { rules?: unknown };
  delete (rest as { rules?: unknown }).rules;
  const rg = normalizeRowGen(rest.rowGen as unknown);
  return {
    ...rest,
    rowGen: rg,
    rowGenFilter: typeof rest.rowGenFilter === 'string' ? rest.rowGenFilter : undefined,
    inputJoins: Array.isArray(rest.inputJoins) ? rest.inputJoins : [],
    pickColumns: normalizePicks(rest.pickColumns as unknown),
    computeColumns: normalizeComputes(rest.computeColumns as unknown),
  };
}
