'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { configure, message } = require('../language');
const catalog = require('../locales/messages.json');
const root = path.resolve(__dirname, '..');
test('every catalog entry has English text and exactly matching arguments', () => {
  assert.equal(catalog.length, 884);
  for (const [ko, en] of catalog) {
    assert.ok(ko && en);
    assert.doesNotMatch(en, /[가-힣]/);
    assert.deepEqual((en.match(/\{\d+\}/g) || []).sort(), (ko.match(/\{\d+\}/g) || []).sort());
  }
});
test('interpolation preserves paths and braces without translating values', () => {
  configure(['--lang', 'en'], root);
  try {
    const value = 'C:/한글/{0}/save.sav';
    assert.equal(message(315, value), 'Save file or folder does not exist: ' + value);
    assert.throws(() => message(315), /Missing translation argument/);
    assert.throws(() => configure(['--lang', 'en', '--lang', 'ko'], root), /Usage/);
  } finally { configure(['--lang', 'ko'], root); }
});
test('all 34 main-menu options display in English; exit performs no writes', async () => {
  const source = fs.readFileSync(path.join(root, 'lid-kc.js'), 'utf8');
  const fragment = source.slice(source.indexOf('async function interactive('), source.indexOf('async function main('));
  configure(['--lang', 'en'], root);
  try {
    const lines = [];
    const context = vm.createContext({ tr: message, readSave: () => ({}), printStatus: () => {}, formatNumber: String, LIMITED_RECIPE_DEFINITION_COUNT: 25, ALL_RECIPE_DEFINITION_COUNT: 356, STEAM_DECAL_DEFINITION_COUNT: 100, console: { log: line => lines.push(line) } });
    vm.runInContext(fragment, context);
    await context.interactive({ question: async prompt => { lines.push(prompt); return '0'; } }, 'unused');
    assert.doesNotMatch(lines.join('\n'), /[가-힣]/);
    for (let n = 1; n <= 34; n++) assert.ok(lines.some(line => line.trimStart().startsWith(`${n}.`)), `Missing menu ${n}`);
  } finally { configure(['--lang', 'ko'], root); }
});
test('real CLI reports English path failures and preserves the supplied path', () => {
  const missing = path.join(root, 'nonexistent-language-fixture', '한글', '111.sav');
  assert.equal(fs.existsSync(missing), false);
  const result = spawnSync(process.execPath, ['--no-warnings', 'lid-kc.js', '--lang', 'en', 'status', '--save', missing, '--yes'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Save file or folder does not exist/);
  assert.ok(result.stderr.includes(missing));
  assert.equal(fs.existsSync(missing), false);
});
