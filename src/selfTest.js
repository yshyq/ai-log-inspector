import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeLogs } from './logAnalyzer.js';
import { createDemoLogs } from './demoData.js';
import { inferLevel, normalizeMessage, parseTimestamp } from './text.js';

export async function runTests() {
  assert.equal(parseTimestamp('2026-05-07 10:00:00').getFullYear(), 2026);
  assert.equal(inferLevel('bad ERROR happened'), 'ERROR');
  assert.equal(
    normalizeMessage('2026-05-07 10:05:03 ERROR user_id=123 cost=3000ms'),
    '<time> ERROR user_id=<id> cost=<num>ms',
  );

  const dir = join(tmpdir(), `log-inspector-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  createDemoLogs(dir);
  return analyzeLogs({
    dir,
    from: '2026-05-07 10:00:00',
    to: '2026-05-07 10:30:00',
  }).then((result) => {
    assert.equal(result.totals.linesInRange, 16);
    assert.ok(result.topClusters.length > 0);
    assert.ok(result.suspectedChain.length > 0);
    rmSync(dir, { recursive: true, force: true });
  });
}
