'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const m2g=require('../m2g-knife');
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lid-m2g-test-'));
  t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('lid-m2g-test-'));fs.rmSync(dir,{recursive:true,force:true});});
  const file=path.join(dir,'masters.db'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE master_atk_scale(id TEXT PRIMARY KEY,scale INTEGER,strrate INTEGER,dexrate INTEGER,grd_delaycf INTEGER); CREATE TABLE unrelated(value INTEGER); INSERT INTO unrelated VALUES(99)');
  const ins=db.prepare('INSERT INTO master_atk_scale VALUES(?,?,70,30,2)');
  for(const id of m2g.IDS)ins.run(id,100);
  ins.run('ANI_CH_ATK_WP56_Fire_01',35);ins.run('ANI_CH_ATK_WP56_Fire_02',20);ins.run('ANI_CH_ATK_WP56_Special',17);db.close();
  let count=0;
  return {file,backups:()=>count,deps:{isGameRunning:()=>false,backup:bytes=>{const dest=path.join(dir,`backup-${++count}.bak`);fs.writeFileSync(dest,bytes);return dest;}}};
}
function edit(file,sql){const db=new DatabaseSync(file);try{db.exec(sql);}finally{db.close();}}
function rows(file,table='master_atk_scale'){const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map(row=>({...row}));}finally{db.close();}}
test('M2G changes exactly two knife scales and restores originals while preserving other patches',t=>{
  const {file,deps,backups}=fixture(t),original=rows(file),bytes=fs.readFileSync(file);
  const result=m2g.change(file,false,deps);assert.deepEqual(fs.readFileSync(result.backupPath),bytes);
  assert.deepEqual(rows(file),original.map(row=>m2g.IDS.includes(row.id)?{...row,scale:200}:row));
  assert.equal(m2g.change(file,false,deps).changed,false);assert.equal(backups(),1);
  edit(file,"UPDATE unrelated SET value=777; UPDATE master_atk_scale SET grd_delaycf=9 WHERE id='ANI_CH_ATK_WP56_Fire_03'");
  m2g.change(file,true,deps);assert.equal(m2g.status(file).applied,false);
  assert.deepEqual(rows(file),original.map(row=>row.id==='ANI_CH_ATK_WP56_Fire_03'?{...row,grd_delaycf:9}:row));
  assert.equal(rows(file,'unrelated')[0].value,777);assert.equal(m2g.change(file,true,deps).changed,false);
});
test('preexisting 200 is preserved, mixed baselines round-trip without multiplying again',t=>{
  const {file,deps,backups}=fixture(t);
  edit(file,"UPDATE master_atk_scale SET scale=200 WHERE id='ANI_CH_ATK_WP56_Fire_03'");
  const before=rows(file);m2g.change(file,false,deps);m2g.change(file,true,deps);assert.deepEqual(rows(file),before);
  edit(file,"UPDATE master_atk_scale SET scale=200 WHERE id LIKE '%Fire_03'");
  const count=backups();assert.equal(m2g.change(file,false,deps).changed,false);assert.equal(backups(),count);
});
test('running game, backup failure, invalid schema and conflicting metadata never overwrite',t=>{
  const {file,deps}=fixture(t),bytes=fs.readFileSync(file);
  assert.throws(()=>m2g.change(file,false,{...deps,isGameRunning:()=>true}),/종료/);
  assert.throws(()=>m2g.change(file,false,{...deps,backup:()=>{throw Error('disk full');}}),/disk full/);
  assert.deepEqual(fs.readFileSync(file),bytes);
  m2g.change(file,false,deps);edit(file,"UPDATE master_atk_scale SET scale=100 WHERE id='ANI_CH_ATK_WP56_Fire_03'");
  const conflict=fs.readFileSync(file);assert.throws(()=>m2g.change(file,true,deps),/기록/);assert.deepEqual(fs.readFileSync(file),conflict);
  edit(file,"UPDATE master_atk_scale SET scale=0 WHERE id='ANI_CH_ATK_WP56_Fire_03'");
  assert.throws(()=>m2g.change(file,false,deps),/예상/);
  edit(file,"DELETE FROM master_atk_scale WHERE id='ANI_CH_ATK_WP56_FF_Fire_03'");
  assert.throws(()=>m2g.change(file,false,deps),/예상/);
});
test('SQL failure after first row rolls back whole patch',t=>{
  const {file,deps}=fixture(t),before=rows(file);
  edit(file,"CREATE TRIGGER reject_m2g BEFORE UPDATE ON master_atk_scale WHEN NEW.id='ANI_CH_ATK_WP56_Fire_03' BEGIN SELECT RAISE(ABORT,'blocked'); END");
  assert.throws(()=>m2g.change(file,false,deps),/blocked/);assert.deepEqual(rows(file),before);assert.equal(m2g.status(file).applied,false);
});
test('M2G menu routes apply/restore and cancellation without offering knife-only mode',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../lid-kc.js'),'utf8'),calls=[];
  const context=vm.createContext({console:{log(){}},require:()=>({status:()=>({applied:true,rows:[{id:m2g.IDS[0],scale:100}]}),change:(...args)=>{calls.push(args);return {changed:false};}}),getMasterDatabasePath:()=>'/db',isGameRunning:()=>false,createMasterDatabaseBackup:()=>'/backup',confirm:async()=>true});
  vm.runInContext(source.slice(source.indexOf('async function manageM2gKnife('),source.indexOf('function setCollisionMushroomThirtyMinutes(')),context);
  await context.manageM2gKnife({},null,false,true);await context.manageM2gKnife({},null,true,true);
  context.confirm=async()=>false;await context.manageM2gKnife({},null);
  assert.deepEqual(calls.map(args=>args[1]),[false,true]);
});
test('script-derived model: knife-only ranges do not clear same-bullet firing lock (not in-game execution)',()=>{
  let fired=6;
  function canFire(selected){if(fired!==selected)fired=6;return fired!==selected;}
  assert.equal(canFire(2),true);fired=2;
  for(let rotation=0;rotation<100;rotation++)assert.equal(canFire(2),false);
  assert.equal(canFire(0),true);assert.equal(canFire(2),true);
});
