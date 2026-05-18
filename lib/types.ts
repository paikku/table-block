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

export interface DerivedConfig {
  kind: 'derived';
  name: string;
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

export function normalizeNodeConfig(cfg: NodeConfig): NodeConfig {
  if (cfg.kind !== 'derived') return cfg;
  // legacy rules 필드가 있어도 무시 (DerivedConfig 에서 제거됨).
  const { ...rest } = cfg as DerivedConfig & { rules?: unknown };
  delete (rest as { rules?: unknown }).rules;
  return {
    ...rest,
    inputJoins: Array.isArray(rest.inputJoins) ? rest.inputJoins : [],
    pickColumns: normalizePicks(rest.pickColumns as unknown),
    computeColumns: normalizeComputes(rest.computeColumns as unknown),
  };
}
