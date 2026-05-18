import type { FlowDoc } from './types';

export const SAMPLE_FLOW: FlowDoc = {
  nodes: [
    {
      id: 'd1',
      kind: 'dynamic',
      position: { x: 40, y: 60 },
      config: {
        kind: 'dynamic',
        name: 'price_feed',
        schema: [
          { name: 'id', type: 'number' },
          { name: 'price', type: 'number' },
        ],
        fetchUrl: 'mock://prices',
        params: {},
        cacheTtlSec: 60,
      },
    },
    {
      id: 'c1',
      kind: 'crud',
      position: { x: 40, y: 260 },
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
      position: { x: 360, y: 160 },
      config: {
        kind: 'derived',
        name: 'final_price',
        rowGen: { type: 'keysFrom', fromNodeId: 'd1', keys: ['id'] },
        cellRules: [
          { name: 'id', mode: 'pick', from: 'd1', col: 'id' },
          { name: 'price', mode: 'pick', from: 'd1', col: 'price' },
          { name: 'rate', mode: 'pick', from: 'c1', col: 'rate' },
          { name: 'final', mode: 'formula', formula: 'row.price * (1 - (out.rate ?? 0))' },
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
      position: { x: 680, y: 160 },
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
      position: { x: 980, y: 160 },
      config: {
        kind: 'derived',
        name: 'report',
        rowGen: { type: 'keysFrom', fromNodeId: 'i1', keys: ['id'] },
        cellRules: [
          { name: 'id', mode: 'pick', from: 'i1', col: 'id' },
          { name: 'final', mode: 'pick', from: 'i1', col: 'final' },
          { name: 'tier', mode: 'pick', from: 'i1', col: 'tier' },
        ],
      },
    },
  ],
  edges: [
    { id: 'e-d1-r1', source: 'd1', target: 'r1' },
    { id: 'e-c1-r1', source: 'c1', target: 'r1' },
    { id: 'e-r1-i1', source: 'r1', target: 'i1' },
    { id: 'e-i1-r2', source: 'i1', target: 'r2' },
  ],
};
