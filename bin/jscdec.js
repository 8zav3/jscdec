#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { decompileFile } = require('../src/index');

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) {
  console.error('usage: jscdec <file.jsc|dir> [-o out] [--runtime <electron.exe> --allow-runtime-exec]');
  process.exit(args.length ? 0 : 1);
}

const opt = {};
let out = null;
const files = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-o' || a === '--out') {
    if (i + 1 >= args.length) {
      console.error('error: missing output path after ' + a);
      process.exit(1);
    }
    out = args[++i];
  } else if (a === '--runtime') {
    if (i + 1 >= args.length) {
      console.error('error: missing executable path after --runtime');
      process.exit(1);
    }
    opt.exe = args[++i];
  } else if (a === '--allow-runtime-exec' || a === '--confirm-runtime-exec') {
    opt.confirmRuntimeExec = true;
  } else if (a.startsWith('-')) {
    console.error('error: unknown option ' + a);
    process.exit(1);
  } else {
    files.push(a);
  }
}

if (opt.exe && !opt.confirmRuntimeExec) {
  console.error(
    'error: refusing to execute external binary "' + opt.exe + '" without explicit consent.\n' +
    'WARNING: Running an untrusted Electron/Node executable can execute arbitrary code.\n' +
    'Re-run with --allow-runtime-exec only if you trust this binary.'
  );
  process.exit(1);
}

if (!files.length) {
  console.error('error: no input files specified');
  process.exit(1);
}

const list = [];
let failed = 0;

for (const f of files) {
  try {
    const st = fs.statSync(f);
    if (st.isDirectory()) {
      for (const x of fs.readdirSync(f)) {
        if (x.endsWith('.jsc')) list.push(path.join(f, x));
      }
    } else {
      list.push(f);
    }
  } catch (e) {
    console.error('FAIL', f, e && e.message ? e.message : String(e));
    failed++;
  }
}

if (!list.length && failed === 0) {
  console.error('error: no .jsc files found');
  process.exit(1);
}

for (const f of list) {
  try {
    const js = decompileFile(f, opt);
    const o = out ? (list.length > 1 ? path.join(out, path.basename(f, '.jsc') + '.js') : out) : null;
    if (o) {
      fs.mkdirSync(path.dirname(o), { recursive: true });
      fs.writeFileSync(o, js);
      console.error('ok  ', f, '->', o);
    } else {
      process.stdout.write(js);
    }
  } catch (e) {
    failed++;
    const msg = e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : String(e);
    console.error('FAIL', f, msg);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
