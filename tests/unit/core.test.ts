import { describe, it, expect } from 'vitest';
import { snapshotHash, compareSnapshots } from '../../src/core/services/snapshot-comparator.service.js';
import { matches, render } from '../../src/core/services/rule-engine.service.js';
import { retryDelayMs, responseKind } from '../../src/core/services/retry.service.js';
describe('núcleo', () => {
  it('hash estável', () => expect(snapshotHash({ a: 1 })).toBe(snapshotHash({ a: 1 })));
  it('primeiro snapshot não gera evento', () =>
    expect(compareSnapshots(null, { status: 'A' }, { fields: [{ path: 'status', eventType: 'S' }] })).toEqual(
      [],
    ));
  it('detecta mudanças', () =>
    expect(
      compareSnapshots(
        { status: 'A', documents: [] },
        { status: 'B', documents: [{ id: '1' }] },
        {
          fields: [{ path: 'status', eventType: 'S' }],
          collections: [{ path: 'documents', identityField: 'id', eventType: 'D' }],
        },
      ),
    ).toHaveLength(2));
  it('regras', () => {
    expect(matches({ 'data.x': { equals: 'ok' } }, { data: { x: 'ok' } })).toBe(true);
    expect(render('Olá {{data.x}}', { data: { x: 'ok' } })).toBe('Olá ok');
  });
  it('retry', () => {
    expect(retryDelayMs(1)).toBe(30000);
    expect(responseKind(500)).toBe('temporary');
  });
});
