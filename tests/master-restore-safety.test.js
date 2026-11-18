'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{createRequire}=require('node:module'),{DatabaseSync}=require('node:sqlite');
const safety=require('../master-restore-safety');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lid-master-restore-'));t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('lid-master-restore-'));fs.rmSync(dir,{recursive:true,force:true});});const current=path.join(dir,'current.db'),backup=path.join(dir,'backup.db');const db=new DatabaseSync(current);db.exec("CREATE TABLE master_body_detail(type TEXT, value INTEGER); CREATE TABLE master_bodylvl_status_value(lvl INTEGER); CREATE TABLE master_bodylvl_exp(lvl INTEGER); CREATE TABLE master_item(itemid TEXT PRIMARY KEY, sell_money INTEGER, sell_spirit INTEGER NOT NULL DEFAULT 0); INSERT INTO master_item VALUES('ITMT_STEROID_1',2000,4000); INSERT INTO master_body_detail VALUES('BAL',45);");db.close();fs.copyFileSync(current,backup);return {dir,current,backup};}
function update(file,sql){const d=new DatabaseSync(file);try{d.exec(sql);}finally{d.close();}}
test('whole DB comparison supports the Node 22.5 statement API without iterate',t=>{
 const {current,backup}=setup(t),script=path.resolve(__dirname,'../master-restore-safety.js'),localRequire=createRequire(script);
 class EarlyDatabase {constructor(...args){this.db=new DatabaseSync(...args);}prepare(sql){const statement=this.db.prepare(sql);return {get:(...args)=>statement.get(...args),all:(...args)=>statement.all(...args),setReadBigInts:value=>statement.setReadBigInts(value)};}close(){this.db.close();}}
 const context=vm.createContext({require:name=>name==='node:sqlite'?{DatabaseSync:EarlyDatabase}:localRequire(name),module:{exports:{}}});vm.runInContext(fs.readFileSync(script,'utf8'),context);assert.equal(context.module.exports.assertCompatible(current,backup),true);
});
test('whole fighter DB restore permits only fighter data differences and ignores physical row order',t=>{const {current,backup}=setup(t);update(current,"UPDATE master_body_detail SET value=50; INSERT INTO master_bodylvl_status_value VALUES(50);");assert.equal(safety.assertCompatible(current,backup),true);});
test('new item schema, changed sale values and unrelated mods cannot be overwritten',t=>{
 const {current,backup}=setup(t),baseline=fs.readFileSync(current);
 update(backup,'ALTER TABLE master_item DROP COLUMN sell_spirit;');assert.throws(()=>safety.assertCompatible(current,backup),/schema differs/);assert.ok(fs.readFileSync(current).equals(baseline));
 fs.copyFileSync(current,backup);update(backup,'UPDATE master_item SET sell_money=200,sell_spirit=0;');assert.throws(()=>safety.assertCompatible(current,backup),/unrelated table differs: master_item/);assert.ok(fs.readFileSync(current).equals(baseline));
 fs.copyFileSync(current,backup);update(backup,'CREATE TABLE unrelated_mod(value INTEGER);');assert.throws(()=>safety.assertCompatible(current,backup),/schema differs/);assert.ok(fs.readFileSync(current).equals(baseline));
});
test('DB sidecars and corrupt backups fail without writes',t=>{const {current,backup}=setup(t),baseline=fs.readFileSync(current);fs.writeFileSync(current+'-wal','busy');assert.throws(()=>safety.assertCompatible(current,backup),/in use/);fs.unlinkSync(current+'-wal');fs.writeFileSync(backup,'invalid');assert.throws(()=>safety.assertCompatible(current,backup));assert.ok(fs.readFileSync(current).equals(baseline));});
test('exact 64-bit integers, SQL types and row multisets are compared without precision loss',t=>{
 const {current,backup}=setup(t);update(current,"CREATE TABLE exact_values(value); INSERT INTO exact_values VALUES(9223372036854775807),(-9223372036854775808),(9007199254740993),(9007199254740993),('9007199254740993');");fs.copyFileSync(current,backup);
 update(backup,"DELETE FROM exact_values; INSERT INTO exact_values VALUES('9007199254740993'),(9007199254740993),(9223372036854775807),(9007199254740993),(-9223372036854775808);");assert.equal(safety.assertCompatible(current,backup),true);
 update(backup,'UPDATE exact_values SET value=9007199254740992 WHERE typeof(value)=\'integer\' AND value=9007199254740993;');assert.throws(()=>safety.assertCompatible(current,backup),/unrelated table differs: exact_values/);
 fs.copyFileSync(current,backup);update(backup,"UPDATE exact_values SET value='9007199254740993' WHERE typeof(value)='integer' AND value=9007199254740993;");assert.throws(()=>safety.assertCompatible(current,backup),/unrelated table differs: exact_values/);
 fs.copyFileSync(current,backup);update(backup,'DELETE FROM exact_values WHERE rowid=(SELECT rowid FROM exact_values WHERE value=9007199254740993 LIMIT 1);');assert.throws(()=>safety.assertCompatible(current,backup),/unrelated table differs: exact_values/);
});
test('restore preflight rejects before backup and preserves a concurrent DB update after backup',t=>{
 const {dir,current,backup}=setup(t),script=path.resolve(__dirname,'../lid-kc.js'),context=vm.createContext({require:createRequire(script),module:{exports:{}},__dirname:path.dirname(script),Buffer,console,process});
 vm.runInContext(fs.readFileSync(script,'utf8')+'\nglobalThis.api={restoreFighterLimits};',context);context.currentDb=current;context.backupCalled=0;context.onBackup=bytes=>{context.backupCalled++;const file=path.join(dir,'safety.db');fs.writeFileSync(file,bytes);update(current,'UPDATE master_item SET sell_spirit=5000;');return file;};
 vm.runInContext('getMasterDatabasePath=()=>currentDb;isGameRunning=()=>false;listFighterLimitBackups=()=>[];createMasterDatabaseBackup=bytes=>onBackup(bytes);',context);
 update(backup,'UPDATE master_item SET sell_money=200;');assert.throws(()=>context.api.restoreFighterLimits('unused',backup),/unrelated table/);assert.equal(context.backupCalled,0);
 fs.copyFileSync(current,backup);assert.throws(()=>context.api.restoreFighterLimits('unused',backup),/changed before fighter restore/);assert.equal(context.backupCalled,1);const d=new DatabaseSync(current,{readOnly:true});try{assert.equal(d.prepare('SELECT sell_spirit FROM master_item').get().sell_spirit,5000);}finally{d.close();}
});
test('a new WAL appearing after the safety backup blocks restore without changing DB or WAL',t=>{
 const {dir,current,backup}=setup(t),script=path.resolve(__dirname,'../lid-kc.js'),context=vm.createContext({require:createRequire(script),module:{exports:{}},__dirname:path.dirname(script),Buffer,console,process}),before=fs.readFileSync(current);
 vm.runInContext(fs.readFileSync(script,'utf8')+'\nglobalThis.api={restoreFighterLimits};',context);context.currentDb=current;context.onBackup=bytes=>{const file=path.join(dir,'safety.db');fs.writeFileSync(file,bytes);fs.writeFileSync(current+'-wal','another writer WAL');return file;};
 vm.runInContext('getMasterDatabasePath=()=>currentDb;isGameRunning=()=>false;listFighterLimitBackups=()=>[];createMasterDatabaseBackup=bytes=>onBackup(bytes);',context);
 assert.throws(()=>context.api.restoreFighterLimits('unused',backup),/in use or recovering/);assert.ok(fs.readFileSync(current).equals(before));assert.equal(fs.readFileSync(current+'-wal','utf8'),'another writer WAL');assert.ok(fs.readFileSync(backup).equals(before));
});
