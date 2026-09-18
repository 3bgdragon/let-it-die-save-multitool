'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');

test('new Steam-ID directory layout retains old saves, resolves DB and isolates account backups', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lid-layout-test-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('lid-layout-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const library = path.join(dir, '한글 Steam Library');
  const install = path.join(library, 'steamapps', 'common', 'LET IT DIE');
  const savedata = path.join(install, 'Savedata');
  const account = path.join(savedata, '76561198000000001');
  const file = path.join(account, 'brggame.sav');
  const db = path.join(install, 'BrgGame', 'Content', 'masters.db');
  fs.mkdirSync(account, { recursive: true });
  fs.mkdirSync(path.dirname(db), { recursive: true });
  fs.writeFileSync(db, 'path-only DB fixture');
  const context = vm.createContext({ require: createRequire(path.join(root, 'lid-kc.js')), module: { exports: {} }, __dirname: root, Buffer, console, process, install, backupDir: path.join(dir, 'backups') });
  vm.runInContext(fs.readFileSync(path.join(root, 'lid-kc.js'), 'utf8') + '\nfindGameInstallDirectories=()=>[install];backupDirectory=()=>backupDir;globalThis.api={discoverSaves,resolveManualSaveInput,findMasterDatabasePath,createBackup,listBackups,packSave,readSave};', context);
  const a = context.api;
  const packed = a.packSave(JSON.stringify({ soul: { free_money: 1, spirit: 2, bloodnium_point: 3 } }), 1, Buffer.alloc(4));
  fs.writeFileSync(file, packed);
  fs.writeFileSync(path.join(account, 'brggame.bak'), packed);
  fs.writeFileSync(path.join(account, 'steam_autocloud.vdf'), 'not a save');
  fs.mkdirSync(path.join(savedata, '999.sav'));
  for (const input of [file, account, savedata, install, library]) {
    assert.deepEqual(Array.from(a.resolveManualSaveInput(`"${input}"`)), [file]);
  }
  assert.deepEqual(Array.from(a.discoverSaves()), [file]);
  assert.equal(a.readSave(file).data.soul.free_money, 1);
  // No auto-detected install fallback: nested save must find its own DB.
  vm.runInContext('findGameInstallDirectories=()=>[];', context);
  assert.equal(a.findMasterDatabasePath(file), db);
  vm.runInContext('findGameInstallDirectories=()=>[install];', context);
  const old = path.join(savedata, '76561198000000001.sav');
  fs.writeFileSync(old, packed);
  const second = path.join(savedata, '76561198000000002', 'brggame.sav');
  fs.mkdirSync(path.dirname(second)); fs.writeFileSync(second, packed);
  assert.deepEqual(Array.from(a.discoverSaves()).sort(), [old, file, second].sort());
  assert.equal(a.findMasterDatabasePath(old), db);
  const b1 = a.createBackup(file, packed), b2 = a.createBackup(second, packed), bOld = a.createBackup(old, packed);
  assert.deepEqual(Array.from(a.listBackups(file)), [b1]);
  assert.deepEqual(Array.from(a.listBackups(second)), [b2]);
  assert.deepEqual(Array.from(a.listBackups(old)), [bOld]);
  assert.deepEqual(fs.readFileSync(file), packed);
});
