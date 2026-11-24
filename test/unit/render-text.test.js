import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../../src/render/pdf/text.js';

test('tokenize splits words and spaces and toggles bold on **', () => {
  assert.deepEqual(tokenize('a **b c**d\ne'), [
    { text: 'a', isBold: false }, { text: ' ', isSpace: true }, { text: 'b', isBold: true }, { text: ' ', isSpace: true },
    { text: 'c', isBold: true }, { text: 'd', isBold: false }, { text: '\n', isSpace: true }, { text: 'e', isBold: false },
  ]);
});

test('tokenize marks currency words as bold amounts when asked', () => {
  assert.deepEqual(tokenize('pay ₹1,000 now', { amountPrefix: '₹' }), [
    { text: 'pay', isBold: false, isAmount: false }, { text: ' ', isSpace: true },
    { text: '₹1,000', isBold: true, isAmount: true }, { text: ' ', isSpace: true },
    { text: 'now', isBold: false, isAmount: false },
  ]);
});
