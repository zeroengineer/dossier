// Worker for the concurrent-allocation test: opens its own context on a shared db file and allocates numbers.
import { parentPort, workerData } from 'node:worker_threads';
import { openContext } from '../../src/context.js';
import { allocateNumber } from '../../src/services/numbering.js';

const { home, dbFile, count, seriesIds } = workerData;
const ctx = openContext({ home, user: 'tester', dbFile, env: {} });
const numbers = [];
try {
  for (let i = 0; i < count; i++) {
    const seriesId = seriesIds[i % seriesIds.length];
    numbers.push(allocateNumber(ctx, seriesId, { date: '2026-06-01' }).number);
  }
} finally {
  ctx.close();
}
parentPort.postMessage(numbers);
