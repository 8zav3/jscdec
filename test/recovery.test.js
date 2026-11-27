'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FnDec } = require('../src/decompile');
const { decodeBigIntBytes } = require('../src/program');

test('ctxVar walks outward when a function reuses its parent context', () => {
  const st = {
    chain: [
      { names: [], extSlot: 0 },                  // function scope: no own context
      { names: ['first', 'second'], extSlot: 0 }, // module scope
    ],
    ctxRegs: new Map(),
  };
  const expr = FnDec.prototype.ctxVar.call({}, st, undefined, 3, 0);
  assert.equal(expr.k, 'id');
  assert.equal(expr.name, 'second');
});

test('ctxVar does not borrow an outer name when the slot is in range but unnamed', () => {
  const st = {
    chain: [
      { names: [null], extSlot: 0 },
      { names: ['outer'], extSlot: 0 },
    ],
    ctxRegs: new Map(),
  };
  const expr = FnDec.prototype.ctxVar.call({}, st, undefined, 2, 0);
  assert.equal(expr.k, 'id');
  assert.equal(expr.name, 'ctx0_2');
});

test('decodeBigIntBytes handles zero and multi-word values', () => {
  assert.equal(decodeBigIntBytes(Buffer.alloc(0)), 0n);
  assert.equal(decodeBigIntBytes(Buffer.from([0x01])), 1n);
  assert.equal(
    decodeBigIntBytes(Buffer.from([0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01])),
    0x0123456789abcdefn
  );
});
