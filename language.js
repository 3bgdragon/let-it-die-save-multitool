'use strict';
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./locales/messages.json');
let language = 'ko';
function configure(args, directory) {
  const remaining = []; let explicit;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lang') {
      if (explicit || !['ko', 'en'].includes(args[i + 1])) throw Error('Usage: --lang ko | --lang en');
      explicit = args[++i];
    } else remaining.push(args[i]);
  }
  const file = path.join(path.dirname(directory), 'let-it-die-tool-settings.json');
  let saved;
  if (!explicit && fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, 'utf8'))?.language;
  language = explicit || (['ko', 'en'].includes(saved) ? saved : 'ko');
  return remaining;
}
function message(id, ...values) {
  const entry = catalog[id];
  if (!entry) throw Error(`Missing translation: ${id}`);
  return entry[language === 'en' ? 1 : 0].replace(/\{(\d+)\}/g, (_, index) => {
    if (Number(index) >= values.length) throw Error(`Missing translation argument: ${id}:${index}`);
    return String(values[index]);
  });
}
module.exports = { configure, message };
