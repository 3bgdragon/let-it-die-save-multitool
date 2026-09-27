'use strict';
// Read-only structural audit against a pre-localization Git revision.
const fs = require('node:fs'), cp = require('node:child_process'), assert = require('node:assert/strict');
const Module = require('node:module'), parserModule = new Module('localization-audit-parser');
parserModule._compile(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'], 'acorn.cjs');
const acorn = parserModule.exports, catalog = require('../locales/messages.json');
const base = process.argv[2] || 'HEAD';
const files = ['lid-kc.js', 'fighter-menu.js', 'fighter-model.js', 'fighter-bag.js', 'equipment-spirit.js', 'jackal-options.js', 'm2g-knife.js'];
let replacements = 0;
function compare(before, after, location) {
  if (after?.type === 'CallExpression' && after.callee?.name === 'tr') {
    const id = after.arguments[0].value;
    const original = before.type === 'Literal' ? before.value : before.type === 'TemplateLiteral' ? before.quasis.map((q, i) => q.value.cooked + (i < before.expressions.length ? `{${i}}` : '')).join('') : null;
    assert.equal(catalog[id][0], original, location);
    compare(before.expressions || [], after.arguments.slice(1), location + '.arguments');
    replacements++; return;
  }
  if (Array.isArray(before)) {
    assert.equal(after.length, before.length, location);
    before.forEach((item, i) => compare(item, after[i], `${location}[${i}]`)); return;
  }
  if (before && typeof before === 'object') {
    if (before instanceof RegExp) { assert.equal(String(before), String(after), location); return; }
    const keys = Object.keys(before).filter(k => !['start', 'end', 'raw'].includes(k));
    assert.deepEqual(Object.keys(after).filter(k => !['start', 'end', 'raw'].includes(k)), keys, location);
    for (const key of keys) compare(before[key], after[key], location + '.' + key);
  } else assert.equal(after, before, location);
}
for (const file of files) {
  const original = cp.execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const current = fs.readFileSync(file, 'utf8');
  const before = acorn.parse(original, { ecmaVersion: 'latest' });
  const after = acorn.parse(current, { ecmaVersion: 'latest' });
  after.body = after.body.filter(node => {
    const text = current.slice(node.start, node.end);
    return !((node.type === 'VariableDeclaration' && text.includes("require('./language')")) || (node.type === 'IfStatement' && text.includes('configureLanguage(process.argv.slice(2)')));
  });
  compare(before, after, file);
}
console.log(JSON.stringify({ base, files: files.length, replacements, result: 'Only message substitution plus language initialization; original expressions and control flow preserved.' }));
