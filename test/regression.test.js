'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'jscdec.js');
const { decompileFile } = require('../src/index');
const { Heap } = require('../src/heap');
const oracle = require('../src/oracle');

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('Node.js 20.20.2 Bytenode-style .jsc files decompile cleanly', () => {
  const n20Files = [
    '01-classes-async.node20.jsc',
    '02-control-flow.node20.jsc',
    '03-obfuscated-0x.node20.jsc',
  ];
  for (const name of n20Files) {
    const out = decompileFile(path.join(ROOT, 'test-jsc', name));
    assert.match(out, /Detected: V8 11\.3 x64 \(Node\.js 20\)/);
  }

  const classesOut = decompileFile(path.join(ROOT, 'test-jsc', '01-classes-async.node20.jsc'));
  assert.match(classesOut, /class BaseService/);
  assert.match(classesOut, /class AuthService extends BaseService/);
  assert.match(classesOut, /async verify\(/);
});

test('All .jsc files in test-jsc/ decompile without error', () => {
  const files = fs.readdirSync(path.join(ROOT, 'test-jsc')).filter(f => f.endsWith('.jsc'));
  assert.ok(files.length >= 36);
  for (const f of files) {
    const out = decompileFile(path.join(ROOT, 'test-jsc', f));
    assert.ok(out.length > 0, `empty output for ${f}`);
  }
});

test('Unsupported snapshot tag (e.g. 0x0d) and invalid headers throw clear errors', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscdec-tag-'));
  try {
    const sample = Buffer.from(fs.readFileSync(path.join(ROOT, 'test-jsc', '01-classes-async.node20.jsc')));
    // Inject an unknown snapshot tag 0x0d inside the first object's item stream (offset 0x1a)
    const badTag = Buffer.from(sample);
    badTag[0x1a] = 0x0d;
    assert.throws(
      () => new Heap(badTag).parse(),
      /unknown snapshot tag 0xd.*vhash=0x.*W=.*header=0x/i
    );

    const badMagic = Buffer.alloc(64, 0x41);
    assert.throws(
      () => new Heap(badMagic).parse(),
      /Invalid V8 SerializedCodeData \(\.jsc\) magic/i
    );

    const tooSmall = Buffer.alloc(12, 0);
    assert.throws(
      () => new Heap(tooSmall).parse(),
      /too small/i
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI returns exit code 0 on success and non-zero on every failure path', () => {
  const ok = runCli([path.join('test-jsc', '01-classes-async.node20.jsc')]);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /class BaseService/);

  const noArgs = runCli([]);
  assert.notEqual(noArgs.status, 0);

  const badFlag = runCli(['--does-not-exist']);
  assert.notEqual(badFlag.status, 0);

  const missingOut = runCli(['-o']);
  assert.notEqual(missingOut.status, 0);

  const missingFile = runCli([path.join(os.tmpdir(), 'definitely-missing-file-12345.jsc')]);
  assert.notEqual(missingFile.status, 0);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscdec-cli-'));
  try {
    // Empty directory -> non-zero
    const emptyDirRes = runCli([tmp]);
    assert.notEqual(emptyDirRes.status, 0);

    // Corrupt / unknown tag 0x0d file -> non-zero
    const badFile = path.join(tmp, 'bad-tag.jsc');
    const sample = Buffer.from(fs.readFileSync(path.join(ROOT, 'test-jsc', '01-classes-async.node20.jsc')));
    sample[0x1a] = 0x0d;
    fs.writeFileSync(badFile, sample);
    const badRes = runCli([badFile]);
    assert.notEqual(badRes.status, 0);
    assert.match(badRes.stderr, /FAIL.*unknown snapshot tag 0xd/i);

    // Mixed directory (1 valid + 1 invalid) -> non-zero
    fs.copyFileSync(path.join(ROOT, 'test-jsc', '02-control-flow.node20.jsc'), path.join(tmp, 'good.jsc'));
    const outDir = path.join(tmp, 'out');
    const mixedRes = runCli([tmp, '-o', outDir]);
    assert.notEqual(mixedRes.status, 0);
    assert.ok(fs.existsSync(path.join(outDir, 'good.js')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Discovered Electron executables are never executed implicitly during decompilation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscdec-safety-'));
  try {
    const marker = path.join(tmp, 'EXECUTED.txt');
    const jscPath = path.join(tmp, 'app.jsc');
    fs.copyFileSync(path.join(ROOT, 'test-jsc', '01-classes-async.electron32.jsc'), jscPath);

    // Simulate an unpacked Electron application directory with icudtl.dat + an executable
    fs.writeFileSync(path.join(tmp, 'icudtl.dat'), 'dummy');
    const fakeExe = path.join(tmp, 'UntrustedApp.exe');
    // Write a PE-named file (and a .cmd on Windows just in case) that would create marker if executed
    fs.writeFileSync(fakeExe, 'not-to-be-executed');
    const canaryScript = path.join(tmp, 'canary.cmd');
    fs.writeFileSync(canaryScript, `@echo executed > "${marker}"\r\n`);

    // 1. Direct API decompilation must NOT execute any discovered binary
    const js = decompileFile(jscPath);
    assert.ok(js.length > 0);
    assert.equal(fs.existsSync(marker), false);

    // 2. CLI without --runtime must NOT execute any discovered binary (even with JSC_RUNTIME set)
    const cliRes = runCli([jscPath], { JSC_RUNTIME: canaryScript });
    assert.equal(cliRes.status, 0);
    assert.equal(fs.existsSync(marker), false);

    // 3. CLI with --runtime but without --allow-runtime-exec must refuse and exit non-zero
    const unconfirmed = runCli([jscPath, '--runtime', canaryScript]);
    assert.notEqual(unconfirmed.status, 0);
    assert.match(unconfirmed.stderr, /--allow-runtime-exec/);
    assert.equal(fs.existsSync(marker), false);

    // 4. oracle.resolve() without confirmRuntimeExec: true must throw without executing
    assert.throws(
      () => oracle.resolve(canaryScript, '', [{ k: 'ro', a: 0, b: 1 }]),
      /Refusing to execute external binary/i
    );
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('RC4 _0x string-array deobfuscation decodes all strings and preserves decoder when disabled', () => {
  const sample = path.join(ROOT, 'test-jsc', 'toy_rc4.jsc');
  const clean = decompileFile(sample);
  assert.match(clean, /const GREETING = "hello from the toy";/);
  assert.match(clean, /console\.log\(risky\(3\)\);/);
  assert.match(clean, /throw new Error\("negative"\);/);
  assert.match(clean, /return "caught " \+ err\.message;/);

  const raw = decompileFile(sample, { deobfuscate: false });
  assert.match(raw, /function _0x1afd/);
  assert.match(raw, /function _0x2f3b/);
});
