import test from 'node:test';
import assert from 'node:assert/strict';
import { sum } from './stats.js';
test('empty', () => assert.equal(sum([]), 0));
test('normal', () => assert.equal(sum([1, 2, 3]), 6));
test('negative boundary', () => assert.equal(sum([-1, 0, 1]), 0));
