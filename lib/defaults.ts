import type { FlowDoc } from './types';

export const SAMPLE_FLOW: FlowDoc = {
  nodes: [
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
        ],
        rowsJson: JSON.stringify(
          [{ base_ccy: 'KRW', target_ccy: 'USD', vat_rate: 0.1, promo_active: true }],
          null,
          2,
        ),
        history: false,
        audit: false,
      },
    },
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
    {
      id: 'c1',
      kind: 'crud',
      position: { x: 40, y: 280 },
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
    {
      id: 'r1',
      kind: 'derived',
      position: { x: 700, y: 160 },
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
    {
      id: 'i1',
      kind: 'interceptor',
      position: { x: 1020, y: 160 },
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
      position: { x: 1320, y: 160 },
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
    { id: 'e-v1-d1', source: 'v1', target: 'd1' },
    { id: 'e-v1-r1', source: 'v1', target: 'r1' },
    { id: 'e-d1-r1', source: 'd1', target: 'r1' },
    { id: 'e-c1-r1', source: 'c1', target: 'r1' },
    { id: 'e-r1-i1', source: 'r1', target: 'i1' },
    { id: 'e-i1-r2', source: 'i1', target: 'r2' },
  ],
};
