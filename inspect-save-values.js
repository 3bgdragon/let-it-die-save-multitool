const fs = require('fs');
const zlib = require('zlib');

const savePath = process.argv[2];
const pattern = new RegExp(process.argv[3] || '.', 'i');
const pathPattern = new RegExp(process.argv[4] || '.', 'i');
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

function visit(value, currentPath) {
  if (!value || typeof value !== 'object') return;
  const values = Object.values(value);
  if (pathPattern.test(currentPath) && values.some((child) =>
    (typeof child === 'string' || typeof child === 'number') && pattern.test(String(child)))) {
    matches.push({ path: currentPath, value });
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') {
      visit(child, currentPath ? `${currentPath}.${key}` : key);
    }
  }
}

visit(root, '');
console.log(JSON.stringify(matches, null, 2));
