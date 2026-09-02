const { DatabaseSync } = require('node:sqlite');

const databasePath = process.argv[2];
const mode = process.argv[3] || 'tables';
const db = new DatabaseSync(databasePath, { readOnly: true });

if (mode === 'tables') {
  const rows = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND (
        lower(name) LIKE '%blood%'
        OR lower(name) LIKE '%shop%'
        OR lower(name) LIKE '%vending%'
        OR lower(name) LIKE '%exchange%'
        OR lower(name) LIKE '%item%'
      )
    ORDER BY name
  `).all();
  console.log(JSON.stringify(rows, null, 2));
} else if (mode === 'all-tables') {
  const rows = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `).all();
  console.log(JSON.stringify(rows, null, 2));
} else if (mode === 'query') {
  const sql = process.argv.slice(4).join(' ');
  console.log(JSON.stringify(db.prepare(sql).all(), null, 2));
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
