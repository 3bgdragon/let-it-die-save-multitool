'use strict';
// Development-only mechanical rewrite. Emits an apply_patch patch; never writes
// game files or source files itself. Translation text is reviewed separately.
const fs = require('node:fs');
const cp = require('node:child_process');
const inventory = JSON.parse(cp.execFileSync(process.execPath, ['dev/extract-localization.cjs'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
let patch = '*** Begin Patch\n';
for (const file of new Set(inventory.occurrences.map(o => o.file))) {
  const source = fs.readFileSync(file, 'utf8');
  const occurrences = inventory.occurrences.filter(o => o.file === file && !o.key);
  function rewrite(start, end) {
    const inside = occurrences.filter(o => o.start >= start && o.end <= end);
    const roots = inside.filter(o => !inside.some(p => p !== o && p.start <= o.start && p.end >= o.end));
    let result = '', cursor = start;
    for (const o of roots.sort((a, b) => a.start - b.start)) {
      result += source.slice(cursor, o.start);
      const expressions = (o.expressions || []).map(e => rewrite(e.start, e.end));
      result += `tr(${o.id}${expressions.length ? ', ' + expressions.join(', ') : ''})`;
      cursor = o.end;
    }
    return result + source.slice(cursor, end);
  }
  let result = rewrite(0, source.length);
  const initialization = file === 'lid-kc.js'
    ? "\nconst { message: tr, configure: configureLanguage } = require('./language');\nif (require.main === module) {\n  try { process.argv = [...process.argv.slice(0, 2), ...configureLanguage(process.argv.slice(2), __dirname)]; }\n  catch (error) { console.error(error.message); process.exit(1); }\n}\n"
    : "\nconst { message: tr } = require('./language');\n";
  result = result.replace("'use strict';", "'use strict';" + initialization);
  patch += `*** Update File: ${file}\n@@\n`;
  patch += source.trimEnd().split(/\r?\n/).map(line => '-' + line).join('\n') + '\n';
  patch += result.trimEnd().split(/\r?\n/).map(line => '+' + line).join('\n') + '\n';
}
process.stdout.write(patch + '*** End Patch');
