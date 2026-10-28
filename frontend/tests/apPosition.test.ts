import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listApPositions, upsertApPosition, deleteApPosition, ApPositionValidationError } from '../src/lib/apPosition.js';

describe('apPosition', () => {
  it('upsert then list', () => {
    upsertApPosition('p1', 'AA:BB:CC:DD:EE:01', 0.5, 0.25);
    const list = listApPositions('p1');
    assert.equal(list.length, 1);
    assert.equal(list[0].bssid, 'aa:bb:cc:dd:ee:01');
  });
  it('second upsert updates', () => {
    upsertApPosition('p1', 'aa:bb:cc:dd:ee:01', 0.1, 0.1);
    const list = listApPositions('p1');
    assert.equal(list.length, 1);
    assert.equal(list[0].x, 0.1);
  });
  it('delete', () => {
    deleteApPosition('p1', 'aa:bb:cc:dd:ee:01');
    assert.equal(listApPositions('p1').length, 0);
  });
  it('rejects invalid bssid', () => {
    assert.throws(() => upsertApPosition('p2', 'bad', 0.5, 0.5), ApPositionValidationError);
  });
  it('rejects invalid x', () => {
    assert.throws(() => upsertApPosition('p2', 'aa:bb:cc:dd:ee:02', 2, 0.5), ApPositionValidationError);
  });
});
