'use strict';
const { Heap, mapOf, rawBytes } = require('./heap');

const MAP = { SFI: 20, SCOPE_INFO: 19, BYTECODE: 45, TRUSTED_FIXED: 92, TRUSTED_BYTES: 94, ONE_BYTE_STR: 18, TWO_BYTE_STR: 108, TWO_BYTE_STR_W8: 112, HEAP_NUMBER: 25, FIXED: 12, FIXED2: 13 };
const smi = (w) => (w && w.t === 'raw') ? (w.v | 0) >> 1 : null;

function load(buf) {
  const h = new Heap(buf);
  h.parse();
  return h;
}

// V8 14.6 static-root indices for inline string maps (see decompile/data/root_values146.json).
const ONE_BYTE_STRING_MAPS_146 = new Set([15, 16, 121, 123, 125, 127, 130, 132, 134, 135, 137, 139]);
const TWO_BYTE_STRING_MAPS_146 = new Set([119, 120, 122, 124, 126, 128, 129, 131, 133, 136, 138, 140]);

function strOf(h, o, refs) {
  const m = mapOf(h, o);
  const sfiMap = h.objs[0] ? mapOf(h, h.objs[0]) : 20;
  const looksLikeOneByte = m === sfiMap - 1 && h.W === 4 && o.size >= 4 &&
    o.words[1]?.t === 'raw' && o.words[2]?.t === 'raw' &&
    o.words[2].v >= 0 && 3 + Math.ceil(o.words[2].v / 4) === o.size;
  const isOneByte = m === sfiMap - 2 || m === sfiMap - 3 || looksLikeOneByte || ONE_BYTE_STRING_MAPS_146.has(m);
  const isTwoByte = m === (sfiMap === 17 ? 127 : MAP.TWO_BYTE_STR) || m === MAP.TWO_BYTE_STR_W8 || TWO_BYTE_STRING_MAPS_146.has(m);
  if (isOneByte || isTwoByte) {
    const len = h.W === 8 ? o.words[1].hi : o.words[2].v;
    if (!Number.isFinite(len) || len < 0) return null;
    const bytes = rawBytes(o, h.W === 8 ? 2 : 3, o.size);
    const max = isOneByte ? bytes.length : Math.floor(bytes.length / 2);
    if (len > max) return null;
    return isOneByte ? bytes.subarray(0, len).toString('latin1') : bytes.subarray(0, len * 2).toString('utf16le');
  }
  return null;
}

function readBytecodeArray(h, o) {
  if (h.W === 8) {
    const length = o.words[1].hi;
    const bytes = rawBytes(o, 8, o.size).subarray(0, length);
    return {
      obj: o,
      length,
      bytes,
      srcpos: o.words[3].t === 'obj' ? h.objs[o.words[3].id] : null,
      handlers: o.words[4].t === 'obj' ? h.objs[o.words[4].id] : null,
      pool: o.words[5].t === 'obj' ? h.objs[o.words[5].id] : null,
      frameSize: o.words[6].lo,
      params: o.words[6].hi & 0xffff,
      maxArgs: o.words[6].hi >>> 16,
    };
  }
  const length = smi(o.words[2]);
  const bytes = rawBytes(o, 10, o.size).subarray(0, length);
  return {
    obj: o,
    length,
    bytes,
    srcpos: o.words[4].t === 'obj' ? h.objs[o.words[4].id] : null,
    handlers: o.words[5].t === 'obj' ? h.objs[o.words[5].id] : null,
    pool: o.words[6].t === 'obj' ? h.objs[o.words[6].id] : null,
    frameSize: o.words[7].v,
    params: o.words[8].v & 0xffff,
    maxArgs: o.words[8].v >>> 16,
  };
}

function functions(h) {
  const list = [];
  for (const o of h.objs) {
    if (mapOf(h, o) !== MAP.SFI) continue;
    const d = o.words[1];
    if (!d || d.t !== 'obj') continue;
    const bo = h.objs[d.id];
    if (mapOf(h, bo) !== MAP.BYTECODE) continue;
    list.push({ sfi: o, bc: readBytecodeArray(h, bo) });
  }
  return list;
}

module.exports = { load, functions, strOf, smi, MAP };
