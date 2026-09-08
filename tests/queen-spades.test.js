'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { parseQueenOfSpadesValue: parse } = require('../lid-kc');

test('Queen percentage and effect multiplier accept values above old caps', () => {
  assert.equal(parse(5001), 5001);
  assert.equal(parse('100000'), 100000);
  assert.equal(parse(1000, true), 30000);
  assert.equal(parse(166.7, true), 5001);
  assert.equal(parse(2147483647), 2147483647);
  assert.equal(parse(1.25, true), 38);
});

test('Queen rejects invalid values and parameter overflow', () => {
  for (const value of [0, -1, '', 'invalid', NaN, Infinity, 1.5, 2147483648]) {
    assert.throws(() => parse(value), /2,147,483,647/);
  }
  for (const value of [0, -1, 0.001, Infinity, 100000000, Number.MAX_VALUE]) {
    assert.throws(() => parse(value, true), /2,147,483,647/);
  }
});

test('Queen writer backs up, preserves other effects, round-trips large values and restores', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lid-queen-test-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('lid-queen-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'masters.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE master_skill(id TEXT PRIMARY KEY,name TEXT,type TEXT,val0 INTEGER,val1 INTEGER,val2 INTEGER,val3 INTEGER,val4 INTEGER,val5 INTEGER,premium INTEGER,rarity INTEGER);
    INSERT INTO master_skill VALUES('SKL_SYLVIA_NMH_02_P','SKILL_NAME.TXT_SKL_SYLVIA_NMH_02','SKLTP_SUPER_DEFUP_NMH',30,20,10,0,0,0,1,5);
    INSERT INTO master_skill VALUES('unrelated','other','other',77,1,2,3,4,5,0,1);`);
  db.close();
  const source = fs.readFileSync(path.join(__dirname, '../lid-kc.js'), 'utf8');
  // Execute the production writer with only environment dependencies isolated to this fixture.
  const constants = source.match(/^const QUEEN_OF_SPADES_.*$/gm).join('\n');
  const start = source.indexOf('function getQueenOfSpadesStatus(');
  const end = source.indexOf('function getWolfRageStatus(', start);
  assert.ok(start > 0 && end > start);
  let backups = 0;
  const context = vm.createContext({
    DatabaseSync, fs, isGameRunning: () => false,
    getMasterDatabasePath: () => file,
    createMasterDatabaseBackup: bytes => {
      const target = path.join(dir, `backup-${++backups}.db`);
      fs.writeFileSync(target, bytes);
      return target;
    },
    sha256: bytes => crypto.createHash('sha256').update(bytes).digest('hex'),
    fail: message => { throw new Error(message); },
  });
  vm.runInContext(constants + '\n' + source.slice(start, end), context);
  const original = fs.readFileSync(file);
  for (const value of [100000, 2147483647]) {
    const result = context.setQueenOfSpadesPercent(null, value);
    assert.equal(result.row.val0, value);
    assert.deepEqual(Array.from([result.row.val1, result.row.val2, result.row.val3, result.row.val4, result.row.val5]), [20, 10, 0, 0, 0]);
  }
  assert.deepEqual(fs.readFileSync(path.join(dir, 'backup-1.db')), original);
  assert.equal(context.setQueenOfSpadesPercent(null, 2147483647).changed, false);
  assert.equal(backups, 2);
  const beforeInvalid = fs.readFileSync(file);
  assert.throws(() => context.setQueenOfSpadesPercent(null, 2147483648));
  assert.deepEqual(fs.readFileSync(file), beforeInvalid);
  assert.equal(backups, 2);
  assert.equal(context.restoreQueenOfSpades(null).row.val0, 30);
  const check = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(check.prepare("SELECT val0 FROM master_skill WHERE id='unrelated'").get().val0, 77);
    assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { check.close(); }
});
