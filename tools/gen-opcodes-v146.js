#!/usr/bin/env node
'use strict';

// Generate src/opcodes146.json from a V8 14.6 source tree.
//
// V8's interpreter opcode numbers are the expansion order of BYTECODE_LIST in
// src/interpreter/bytecodes.h. Two details are easy to get wrong:
//   * CALL_PROPERTY_BYTECODES(V) expands to four entries with real operand
//     lists; dropping it produces a table that decodes CallProperty1 wrongly.
//   * SHORT_STAR_BYTECODE_LIST and Illegal are appended after the unique
//     handlers.
//
// Usage:
//   node tools/gen-opcodes-v146.js /path/to/v8-14.6
//   node tools/gen-opcodes-v146.js /path/to/v8-14.6 src/opcodes146.json
//
// Fetch the matching source with:
//   mkdir -p /tmp/v8_146
//   curl -sL https://chromium.googlesource.com/v8/v8/+archive/refs/tags/14.6.202.34.tar.gz \
//     | tar xz -C /tmp/v8_146

const fs = require('fs');
const path = require('path');

const V8 = process.argv[2] || '/tmp/v8_146';
const OUT = process.argv[3] || path.join(__dirname, '..', 'src', 'opcodes146.json');
const src = fs.readFileSync(path.join(V8, 'src/interpreter/bytecodes.h'), 'utf8')
  .replace(/\\\r?\n/g, ' ');

const call = src.match(/#define CALL_PROPERTY_BYTECODES\(V\)([\s\S]*?)\n\n/);
if (!call) throw new Error('CALL_PROPERTY_BYTECODES macro not found');
const callBlock = call[1].replace(/\/\*[\s\S]*?\*\//g, '');
const callEntries = [...callBlock.matchAll(
  /V\((\w+),\s*ImplicitRegisterUse::(\w+)((?:,\s*OperandType::\w+)*)\)/g
)].map(m => ({ name: m[1], use: m[2], ops: m[3] }));
if (callEntries.length !== 4) throw new Error('unexpected CALL_PROPERTY_BYTECODES expansion');

const start = src.indexOf('#define BYTECODE_LIST_WITH_UNIQUE_HANDLERS_IMPL');
const end = src.indexOf('#define BYTECODE_LIST_WITH_UNIQUE_HANDLERS(', start + 10);
if (start < 0 || end < 0) throw new Error('BYTECODE_LIST_WITH_UNIQUE_HANDLERS_IMPL not found');

let block = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
block = block.replace(
  'CALL_PROPERTY_BYTECODES(V)',
  callEntries.map(e => `V(${e.name}, ImplicitRegisterUse::${e.use}${e.ops})`).join('\n')
);

const entries = [...block.matchAll(
  /V(?:_TSA)?\(\s*(\w+)\s*,\s*ImplicitRegisterUse::(\w+)((?:,\s*OperandType::\w+\s*)*)\)/g
)].map(m => ({ name: m[1], use: m[2], ops: [...m[3].matchAll(/OperandType::(\w+)/g)].map(x => x[1]) }));

const stars = ['Star15', 'Star14', 'Star13', 'Star12', 'Star11', 'Star10', 'Star9',
  'Star8', 'Star7', 'Star6', 'Star5', 'Star4', 'Star3', 'Star2', 'Star1', 'Star0'];
for (const name of stars) entries.push({ name, use: 'kReadAccumulatorWriteShortStar', ops: [] });
entries.push({ name: 'Illegal', use: 'kNone', ops: [] });

const table = entries.map((e, code) => ({ code, name: e.name, ops: e.ops, use: e.use }));
const byName = Object.fromEntries(table.map(o => [o.name, o]));
if (byName.CallProperty1?.ops.join(',') !== 'kReg,kReg,kReg,kFeedbackSlot') {
  throw new Error('CallProperty1 operand list is wrong');
}
if (byName.Return?.code !== 183) throw new Error('Return should be opcode 183');
if (table.length !== 212) throw new Error(`expected 212 opcodes, got ${table.length}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(table, null, 1) + '\n');
console.log(`wrote ${table.length} opcodes to ${OUT}`);
