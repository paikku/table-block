import type { FlowDoc } from './types';

// SAMPLE_FLOW: docs/model/variables.md V-0010 의 closed list 를
// 한 화면에 가시화하기 위한 데모. 각 노드 옆 주석에 어떤 자리의
// 변수 참조를 시연하는지 표시.
//
//   ┌─ Dynamic    fetchUrl 의 ${globals.X}           (d1)
//   ├─ Derived    cellRules 의 inputs.globals.X      (r1)
//   ├─ Derived    rowGen.Filter 술어                  (r3)
//   ├─ Derived    rowGen.Generate (Calendar) 인자    (r4)
//   ├─ Interceptor guard 술어                         (i2)
//   └─ Interceptor effect 인자 (${globals.X})        (i2)

export const SAMPLE_FLOW: FlowDoc = {
  nodes: [
    // ── 변수 노드 (history=off 경량 CRUD = V-0004 의 변수 패턴) ───────
    {
      id: 'v1',
      kind: 'crud',
      position: { x: 40, y: 20 },
      config: {
        kind: 'crud',
        name: 'globals',
        schema: [
          { name: 'base_ccy', type: 'string' },
          { name: 'target_ccy', type: 'string' },
          { name: 'vat_rate', type: 'number' },
          { name: 'promo_active', type: 'boolean' },
          { name: 'target_region', type: 'string' },
          { name: 'period_start', type: 'string' },
          { name: 'period_end', type: 'string' },
          { name: 'alert_threshold', type: 'number' },
          { name: 'notify_enabled', type: 'boolean' },
          { name: 'alert_recipient', type: 'string' },
        ],
        rowsJson: JSON.stringify(
          [
            {
              base_ccy: 'KRW',
              target_ccy: 'USD',
              vat_rate: 0.1,
              promo_active: true,
              target_region: 'KR',
              period_start: '2026-05-01',
              period_end: '2026-05-07',
              alert_threshold: 80,
              notify_enabled: true,
              alert_recipient: 'ops@example.com',
            },
          ],
          null,
          2,
        ),
        history: false,
        audit: false,
      },
    },

    // ── 도메인 데이터 ──────────────────────────────────────────────
    {
      id: 'c2',
      kind: 'crud',
      position: { x: 40, y: 240 },
      config: {
        kind: 'crud',
        name: 'orders',
        schema: [
          { name: 'id', type: 'number' },
          { name: 'region', type: 'string' },
          { name: 'amount', type: 'number' },
          { name: 'ts', type: 'string' },
        ],
        rowsJson: JSON.stringify(
          [
            { id: 1, region: 'KR', amount: 50, ts: '2026-05-02' },
            { id: 2, region: 'KR', amount: 120, ts: '2026-05-03' },
            { id: 3, region: 'JP', amount: 70, ts: '2026-05-04' },
            { id: 4, region: 'KR', amount: 30, ts: '2026-05-05' },
            { id: 5, region: 'KR', amount: 95, ts: '2026-05-06' },
          ],
          null,
          2,
        ),
        history: true,
        audit: false,
      },
    },
    {
      id: 'c1',
      kind: 'crud',
      position: { x: 40, y: 460 },
      config: {
        kind: 'crud',
        name: 'discount_policy',
        schema: [
          { name: 'id', type: 'number' },
          { name: 'rate', type: 'number' },
        ],
        rowsJson: JSON.stringify(
          [
            { id: 1, rate: 0.1 },
            { id: 2, rate: 0.2 },
          ],
          null,
          2,
        ),
        history: true,
        audit: false,
      },
    },

    // ── Dynamic: fetchUrl 안의 ${globals.base_ccy} (params 자리) ──
    {
      id: 'd1',
      kind: 'dynamic',
      position: { x: 360, y: 20 },
      config: {
        kind: 'dynamic',
        name: 'price_feed',
        schema: [
          { name: 'id', type: 'number' },
          { name: 'price', type: 'number' },
        ],
        fetchUrl: 'mock://prices?base=${globals.base_ccy}&quote=${globals.target_ccy}',
        params: {},
        cacheTtlSec: 60,
      },
    },

    // ── Derived rowGen.Filter: 술어에서 inputs.globals 참조 ─────────
    {
      id: 'r3',
      kind: 'derived',
      position: { x: 360, y: 240 },
      config: {
        kind: 'derived',
        name: 'orders_in_region',
        primaryNodeId: 'c2',
        inputJoins: [],
        // rowGen 미지정 → primary(orders) 의 row 그대로 + Filter 적용
        rowGenFilter: 'row.region === inputs.globals.rows[0].target_region',
        pickColumns: [
          { from: 'primary', col: 'id' },
          { from: 'primary', col: 'region' },
          { from: 'primary', col: 'amount' },
          { from: 'primary', col: 'ts' },
        ],
        computeColumns: [
          {
            name: 'amount_with_vat',
            mode: 'formula',
            formula: 'row.amount * (1 + inputs.globals.rows[0].vat_rate)',
          },
        ],
      },
    },

    // ── Derived rowGen.Generate (Calendar): 인자에서 변수 참조 ─────
    // start/end 가 ${globals.period_start} / ${globals.period_end} 로
    // 보간된다. (Dynamic fetchUrl 과 같은 ${node.col} 메커니즘)
    {
      id: 'r4',
      kind: 'derived',
      position: { x: 360, y: 460 },
      config: {
        kind: 'derived',
        name: 'period_days',
        primaryNodeId: '',
        inputJoins: [],
        rowGen: {
          kind: 'generate',
          spec: {
            kind: 'calendar',
            column: 'date',
            start: '${globals.period_start}',
            end: '${globals.period_end}',
            stepDays: 1,
          },
        },
        pickColumns: [],
        computeColumns: [
          {
            name: 'in_period',
            mode: 'formula',
            formula: 'true',
          },
        ],
      },
    },

    // ── Derived cellRules: 기존 final_price (Predicate/Value 자리) ──
    {
      id: 'r1',
      kind: 'derived',
      position: { x: 700, y: 20 },
      config: {
        kind: 'derived',
        name: 'final_price',
        primaryNodeId: 'd1',
        inputJoins: [{ fromNodeId: 'c1', key: 'id' }],
        pickColumns: [
          { from: 'primary', col: 'id' },
          { from: 'primary', col: 'price' },
          { from: 'c1', col: 'rate' },
        ],
        computeColumns: [
          {
            name: 'promo_eligible',
            mode: 'cases',
            cases: [
              {
                when: 'inputs.globals.rows[0].promo_active && row.price >= 50',
                then: 'true',
              },
            ],
            default: 'false',
          },
          {
            name: 'final',
            mode: 'formula',
            formula:
              'row.price * (1 - (out.rate ?? 0)) * (1 + (inputs.globals.rows[0].vat_rate ?? 0))',
          },
          {
            name: 'tier',
            mode: 'cases',
            cases: [
              { when: 'row.price > 100', then: "'high'" },
              { when: 'row.price > 50', then: "'mid'" },
            ],
            default: "'low'",
          },
        ],
      },
    },

    // ── Interceptor: guard 와 effect 양쪽에서 변수 참조 ─────────────
    // deps[]: 첫 upstream(r3) = 데이터, 둘째(v1) = 변수.
    // guard 는 globals.notify_enabled / alert_threshold 참조.
    // effect 는 ${globals.alert_recipient} 로 수신자 보간.
    {
      id: 'i2',
      kind: 'interceptor',
      position: { x: 700, y: 280 },
      config: {
        kind: 'interceptor',
        name: 'alert_high_amount',
        mode: 'filter',
        guard:
          'inputs.globals.rows[0].notify_enabled && row.amount > inputs.globals.rows[0].alert_threshold',
        effect: 'mail:to=${globals.alert_recipient}',
      },
    },

    // ── Interceptor: 기존 validate_final (guard 만, mode=block-on-fail)
    {
      id: 'i1',
      kind: 'interceptor',
      position: { x: 1020, y: 20 },
      config: {
        kind: 'interceptor',
        name: 'validate_final',
        mode: 'block-on-fail',
        guard: 'row.final >= 0',
        effect: 'log:price-check',
      },
    },
    {
      id: 'r2',
      kind: 'derived',
      position: { x: 1320, y: 20 },
      config: {
        kind: 'derived',
        name: 'report',
        primaryNodeId: 'i1',
        inputJoins: [],
        pickColumns: [
          { from: 'primary', col: 'id' },
          { from: 'primary', col: 'final' },
          { from: 'primary', col: 'tier' },
          { from: 'primary', col: 'promo_eligible' },
        ],
        computeColumns: [],
      },
    },
  ],
  edges: [
    // 기존 final_price 라인
    { id: 'e-v1-d1', source: 'v1', target: 'd1' },
    { id: 'e-v1-r1', source: 'v1', target: 'r1' },
    { id: 'e-d1-r1', source: 'd1', target: 'r1' },
    { id: 'e-c1-r1', source: 'c1', target: 'r1' },
    { id: 'e-r1-i1', source: 'r1', target: 'i1' },
    { id: 'e-i1-r2', source: 'i1', target: 'r2' },
    // 새: rowGen Filter 변수 참조
    { id: 'e-c2-r3', source: 'c2', target: 'r3' },
    { id: 'e-v1-r3', source: 'v1', target: 'r3' },
    // 새: rowGen Generate (Calendar) 변수 참조
    { id: 'e-v1-r4', source: 'v1', target: 'r4' },
    // 새: Interceptor guard/effect 변수 참조
    //   (r3 가 첫 upstream → 데이터, v1 은 둘째 → 변수)
    { id: 'e-r3-i2', source: 'r3', target: 'i2' },
    { id: 'e-v1-i2', source: 'v1', target: 'i2' },
  ],
};
