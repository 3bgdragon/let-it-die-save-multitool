const fs = require('fs');
const zlib = require('zlib');

const packed = fs.readFileSync(process.argv[2]);
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
const startPath = process.argv[3].split('.');
let value = root;
for (const part of startPath) value = value?.[part];

function walk(current, path, depth) {
  if (depth > 8) return;
  if (Array.isArray(current)) {
    console.log(`${path}: array(${current.length}) first=${JSON.stringify(current.slice(0, 3))} last=${JSON.stringify(current.slice(-3))}`);
    if (current[0] && typeof current[0] === 'object') walk(current[0], `${path}[0]`, depth + 1);
    return;
  }
  if (current && typeof current === 'object') {
    const keys = Object.keys(current);
    console.log(`${path}: object(${keys.length}) keys=${JSON.stringify(keys.slice(0, 80))}`);
    for (const key of keys) walk(current[key], `${path}.${key}`, depth + 1);
    return;
  }
  console.log(`${path}: ${typeof current}=${JSON.stringify(current)}`);
}

walk(value, startPath.join('.'), 0);
