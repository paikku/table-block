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

export interface DerivedRule {
  when: string;                // ex: row.score > 80
  then: string;                // ex: ({ grade: 'A' })
}

export interface DerivedConfig {
  kind: 'derived';
  name: string;
  primaryNodeId: string;       // pick 대상 노드 id
  pickColumns: string[];
  computeColumns: { name: string; formula: string }[];
  rules: DerivedRule[];
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
        pickColumns: ['id'],
        computeColumns: [{ name: 'derived_value', formula: '`d-${row.id}`' }],
        rules: [{ when: 'row.id === 1', then: "({ derived_value: 'special' })" }],
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
