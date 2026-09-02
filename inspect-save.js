const fs = require('fs');
const zlib = require('zlib');

const savePath = process.argv[2];
const pattern = new RegExp(process.argv[3] || 'automatic|shop|blood|lineup|stock|purchase|expire|reset', 'i');
const packed = fs.readFileSync(savePath);
const declaredSize = packed.readUInt32LE(8);
const chunks = [];
let offset = 16;
let decodedSize = 0;

while (decodedSize < declaredSize) {
  const compressedSize = packed.readUInt32LE(offset + 4);
  const start = offset + 8;
  const chunk = zlib.inflateSync(packed.subarray(start, start + compressedSize));
  chunks.push(chunk);
  decodedSize += chunk.length;
  offset = start + compressedSize;
}

const root = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const matches = [];

function summarize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return { type: 'array', length: value.length, sample: value.slice(0, 5) };
  const keys = Object.keys(value);
  const result = {};
  for (const key of keys.slice(0, 30)) result[key] = value[key];
  if (keys.length > 30) result.__remainingKeys = keys.length - 30;
  return result;
}

function visit(value, path) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (pattern.test(key)) matches.push({ path: childPath, value: summarize(child) });
    if ((typeof child === 'string' || typeof child === 'number') && pattern.test(String(child))) {
      matches.push({ path: childPath, value: child });
    }
    visit(child, childPath);
  }
}

visit(root, '');
console.log(JSON.stringify(matches, null, 2));
