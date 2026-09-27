'use strict';
// Development-only inventory. Uses the parser bundled with Node, never shipped
// as a runtime requirement of the save tool.
const fs = require('node:fs');
const Module = require('node:module');
const parserModule = new Module('localization-parser');
parserModule._compile(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'], 'acorn.cjs');
const acorn = parserModule.exports;
const files = ['lid-kc.js', 'fighter-menu.js', 'fighter-model.js', 'fighter-bag.js', 'equipment-spirit.js', 'jackal-options.js', 'm2g-knife.js'];
const messages = []; const byText = new Map(); const occurrences = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  function visit(node, parent) {
    if (!node || typeof node !== 'object') return;
    let text;
    if (node.type === 'Literal' && typeof node.value === 'string' && /[가-힣]/.test(node.value)) text = node.value;
    if (node.type === 'TemplateLiteral' && node.quasis.some(q => /[가-힣]/.test(q.value.cooked || ''))) text = node.quasis.map((q, i) => q.value.cooked + (i < node.expressions.length ? `{${i}}` : '')).join('');
    if (text !== undefined) {
      const key = parent?.type === 'Property' && parent.key === node && !parent.computed;
      const id = byText.has(text) ? byText.get(text) : messages.length;
      if (!byText.has(text)) { byText.set(text, id); messages.push(text); }
      occurrences.push({ file, id, start: node.start, end: node.end, line: node.loc.start.line, type: node.type, parent: parent?.type, key, expressions: node.expressions?.map(e => ({ start: e.start, end: e.end })) });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (Array.isArray(value)) value.forEach(child => { if (child?.type) visit(child, node); });
      else if (value?.type) visit(value, node);
    }
  }
  visit(ast, null);
}
process.stdout.write(JSON.stringify({ messages, occurrences }));
