'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const vm = require('node:vm'), cp = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const readSource = name => process.env.LID_TEST_INDEX === '1'
  ? cp.execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', `:${name}`], { cwd: root })
  : fs.readFileSync(path.join(root, name));

test('save paths: dropped files/folders, manual paths, explicit flags and actual BAT', async t => {
  const context = vm.createContext({ require: createRequire(path.join(root, 'lid-kc.js')), module: { exports: {} }, __dirname: root, Buffer, process, console: { log() {} } });
  vm.runInContext(readSource('lid-kc.js').toString() + '\nglobalThis.api={parseArguments,chooseSave}; discoverSaves=()=>[];', context);
  const { parseArguments, chooseSave } = context.api;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lid-path-regression-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('lid-path-regression-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const folder = path.join(dir, '한글 경로 (공백)', 'Savedata');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, '111.sav'), data = Buffer.from('path-only synthetic fixture');
  fs.writeFileSync(file, data);
  const prompt = value => ({ question: async () => value });

  await t.test('bare dropped path opens interactive mode and resolves file or folder', async () => {
    for (const value of [file, folder, path.dirname(folder)]) {
      const parsed = parseArguments([value]);
      assert.equal(parsed.args.length, 0);
      assert.equal(await chooseSave(prompt('1'), parsed.savePath), file);
    }
  });
  await t.test('manual input and --save accept quoted Korean/space paths', async () => {
    for (const value of [file, folder, `"${file}"`, `'${folder}'`]) {
      assert.equal(await chooseSave(prompt(value), null), file);
      const parsed = parseArguments(['status', '--save', value, '--yes']);
      assert.equal(parsed.args[0], 'status');
      assert.equal(parsed.yes, true);
      assert.equal(await chooseSave(null, parsed.savePath), file);
    }
  });
  await t.test('multiple saves require selection; missing/wrong files and ambiguous arguments fail', async () => {
    const second = path.join(folder, '222.sav'); fs.writeFileSync(second, data);
    assert.equal(await chooseSave(prompt('2'), folder), second);
    await assert.rejects(chooseSave(null, folder), /여러 개/);
    await assert.rejects(chooseSave(null, path.join(dir, 'missing.sav')), /없습니다/);
    const wrong = path.join(dir, 'not-save.txt'); fs.writeFileSync(wrong, data);
    await assert.rejects(chooseSave(null, wrong), /\.sav/);
    assert.throws(() => parseArguments([file, second]), /한 개/);
    assert.throws(() => parseArguments([file, '--save', second]), /한 개/);
    assert.equal(parseArguments(['backup']).args[0], 'backup');
    assert.equal(parseArguments(['set', 'kc', '100']).args[2], '100');
  });
  await t.test('actual BAT bytes forward file/folder and --save without encoding or quoting loss', { skip: process.platform !== 'win32' }, () => {
    const harness = path.join(dir, 'launcher'); fs.mkdirSync(harness);
    const bat = readSource('run.bat');
    assert.ok(bat.includes(Buffer.from('\r\n')));
    assert.ok(!/(?<!\r)\n/.test(bat.toString()));
    fs.writeFileSync(path.join(harness, 'run.bat'), bat);
    fs.writeFileSync(path.join(harness, 'lid-kc.js'), 'console.log("ARGV_PROBE:"+JSON.stringify(process.argv.slice(2)));');
    for (const args of [[file], [folder], ['--save', file]]) {
      const command = `""${path.join(harness, 'run.bat')}" ${args.map(x => `"${x}"`).join(' ')}"`;
      const result = cp.spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { windowsVerbatimArguments: true, encoding: 'utf8', input: '\r\n', timeout: 10000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const line = result.stdout.split(/\r?\n/).find(x => x.startsWith('ARGV_PROBE:'));
      assert.ok(line, result.stdout + result.stderr);
      const passed = JSON.parse(line.slice('ARGV_PROBE:'.length));
      assert.deepEqual(passed, args);
      assert.equal(parseArguments(passed).savePath, args.at(-1));
    }
  });
  assert.deepEqual(fs.readFileSync(file), data);
});
