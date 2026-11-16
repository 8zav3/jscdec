'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const header = `(function(){
const process = { env: {} };
const TD_UTF8 = new TextDecoder('utf-8');
const TD_UTF16 = new TextDecoder('utf-16le');
function wrapBuf(u8) {
  if (u8._isBuf) return u8;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  u8._isBuf = true;
  u8.readUInt8 = (o) => dv.getUint8(o);
  u8.readInt8 = (o) => dv.getInt8(o);
  u8.readUInt16LE = (o) => dv.getUint16(o, true);
  u8.readInt16LE = (o) => dv.getInt16(o, true);
  u8.readUInt32LE = (o) => dv.getUint32(o, true);
  u8.readInt32LE = (o) => dv.getInt32(o, true);
  u8.readDoubleLE = (o) => dv.getFloat64(o, true);
  u8.readBigUInt64LE = (o) => dv.getBigUint64(o, true);
  u8.writeUInt32LE = (v, o) => { dv.setUint32(o, v >>> 0, true); return o + 4; };
  u8.writeInt32LE = (v, o) => { dv.setInt32(o, v | 0, true); return o + 4; };
  const origSub = u8.subarray.bind(u8);
  u8.subarray = (a, b) => wrapBuf(origSub(a, b));
  u8.slice = (a, b) => wrapBuf(origSub(a, b));
  u8.toString = (enc, a = 0, b = u8.byteLength) => {
    const sub = origSub(a, b);
    if (enc === 'latin1') {
      let s = '';
      for (let i = 0; i < sub.length; i++) s += String.fromCharCode(sub[i]);
      return s;
    }
    if (enc === 'utf16le') return TD_UTF16.decode(sub);
    return TD_UTF8.decode(sub);
  };
  return u8;
}
const Buffer = {
  isBuffer: (x) => !!(x && (x._isBuf || x instanceof Uint8Array)),
  alloc: (n) => wrapBuf(new Uint8Array(n)),
  from: (a) => wrapBuf(new Uint8Array(a.buffer ? a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) : a))
};
const registry = {};
const cache = {};
registry['fs'] = function(m, e) { e.existsSync = () => false; };
registry['path'] = function(m, e) {
  e.join = (...a) => a.join('/');
  e.basename = (p) => String(p).split(/[\\\\/]/).pop();
};
registry['./oracle'] = function(m, e) { e.resolve = () => new Map(); };
`;

const jsonModules = [
  ['./opcodes.json', 'src/opcodes.json', './opcodes'],
  ['../templates/ro-v12.8.json', 'templates/ro-v12.8.json'],
  ['../templates/ro-v12.4-x64.json', 'templates/ro-v12.4-x64.json'],
  ['../templates/ro-v11.3-x64.json', 'templates/ro-v11.3-x64.json'],
  ['../templates/ro-multi.json', 'templates/ro-multi.json'],
];

const jsModules = [
  'heap',
  'model',
  'program',
  'disasm',
  'ast',
  'decompile',
  'decompile-ops',
  'decompile-flow',
  'post',
];

const parts = [header];

for (const [key, relPath, alias] of jsonModules) {
  const raw = fs.readFileSync(path.join(ROOT, relPath), 'utf8').trim();
  const prefix = alias ? `registry['${key}'] = registry['${alias}'] = ` : `registry['${key}'] = `;
  parts.push(`${prefix}function(m) { m.exports = ${raw}; };\n`);
}

for (const name of jsModules) {
  const code = fs.readFileSync(path.join(ROOT, 'src', `${name}.js`), 'utf8');
  parts.push(`registry['./${name}'] = registry['./${name}.js'] = function(module, exports, require, __dirname) {\n${code}\n};\n`);
}

const footer = `function req(id) {
  if (cache[id]) return cache[id].exports;
  const m = { exports: {} };
  cache[id] = m;
  registry[id](m, m.exports, req, '/');
  return m.exports;
}
const { Program } = req('./program');
const { FnDec } = req('./decompile');
const post = req('./post');
const { stmt } = req('./ast');

globalThis.decompileJSC = function(u8, filename = 'compiled.jsc', opts = {}) {
  const t0 = performance.now ? performance.now() : Date.now();
  const buf = wrapBuf(new Uint8Array(u8));
  const prog = new Program(buf, { exe: '', template: '' });
  const top = prog.sfi(prog.h.objs[0]);
  let target = top;
  const topPool = top.bc && top.bc.pool;
  if (topPool) {
    const first = prog.poolVal(top.bc, 0);
    if (first.kind === 'sfi') target = prog.sfi(first.obj);
  }
  const dec = new FnDec(prog, target, [], { moduleWrapper: true });
  const info = dec.run();
  post.process(info, opts);
  post.rename(info);
  const v8ver = prog.detectVersion();
  const cleanName = String(filename).split(/[\\\\/]/).pop();
  const header = '// Decompiled from: ' + cleanName + '\\n// Detected: ' + v8ver + '\\n\\n';
  const code = header + info.body.map(s => stmt(s, '')).filter(x => x !== null).join('\\n') + '\\n';
  const elapsedMs = Math.max(1, Math.round((performance.now ? performance.now() : Date.now()) - t0));
  return {
    ok: true,
    filename: cleanName.replace(/\\.jsc$/i, '') + '.js',
    code,
    v8ver,
    pointerSize: prog.h.W,
    objects: prog.h.objs.length,
    bytes: buf.byteLength,
    elapsedMs
  };
};
})();
`;

parts.push(footer);
const outPath = path.join(ROOT, 'web', 'engine.js');
fs.writeFileSync(outPath, parts.join(''), 'utf8');
console.log('Built', outPath, '(', fs.statSync(outPath).size, 'bytes )');
