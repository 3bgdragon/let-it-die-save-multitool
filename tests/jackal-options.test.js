'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const jackal=require('../jackal-options');
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lid-jackal-test-'));
  t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('lid-jackal-test-'));fs.rmSync(dir,{recursive:true,force:true});});
  const file=path.join(dir,'masters.db'),db=new DatabaseSync(file);
  db.exec(`CREATE TABLE master_const_int(id TEXT PRIMARY KEY,value INTEGER); CREATE TABLE master_jackal(type TEXT PRIMARY KEY,hp INTEGER,${jackal.WEIGHTS.map(col=>col+' INTEGER').join(',')}); CREATE TABLE unrelated(value INTEGER); INSERT INTO unrelated VALUES(99)`);
  const ins=db.prepare('INSERT INTO master_const_int VALUES(?,?)');
  for(const prefix of ['JACKAL','JACKAL15','JACKAL20']) for(const [suffix,value] of [['_AP_TIME_1',300],['_AP_PER_1',200],['_AP_TIME_2',60],['_AP_PER_2',500],['_AP_PER_3',500],['_AP_RATE_PER_MIN',100],['_APPEAR_DISABLE',0]]) ins.run(prefix+suffix,value);
  const row=db.prepare('INSERT INTO master_jackal VALUES(?,?,?,?,?,?,?,?,?)');
  for(const char of ['X','Y','Z']) for(const suffix of [char,char.repeat(2),char.repeat(3),char.repeat(4),char.repeat(4)+'2']) row.run('JACKAL_'+suffix,98765,...(suffix.length===1?[400,100,100,100,300,0,0]:suffix.length===3?[0,0,0,60,240,700,0]:[0,0,0,0,0,700,300]));
  db.close();
  let count=0;
  return {file,backups:()=>count,deps:{isGameRunning:()=>false,backup:bytes=>{const dest=path.join(dir,`backup-${++count}.bak`);fs.writeFileSync(dest,bytes);return dest;}}};
}
function rows(file,table) {const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map(row=>({...row}));}finally{db.close();}}
function edit(file,sql) {const db=new DatabaseSync(file);try{db.exec(sql);}finally{db.close();}}

test('spawn changes exactly first wait and first check; idempotence, profiles and original restoration',t=>{
  const {file,deps,backups}=fixture(t),before=rows(file,'master_const_int'),bytes=fs.readFileSync(file);
  const result=jackal.change(file,'spawn',10,deps);
  assert.deepEqual(fs.readFileSync(result.backupPath),bytes);
  assert.deepEqual(rows(file,'master_const_int'),before.map(row=>jackal.SPAWN_IDS.includes(row.id)?{...row,value:row.id.endsWith('_TIME_1')?10:1000}:row));
  assert.equal(jackal.change(file,'spawn',10,deps).changed,false);assert.equal(backups(),1);
  jackal.change(file,'spawn',5,deps);jackal.change(file,'spawn',null,deps);
  assert.deepEqual(rows(file,'master_const_int'),before);assert.equal(jackal.status(file,'spawn').applied,false);
  assert.equal(jackal.change(file,'spawn',null,deps).changed,false);assert.equal(backups(),3);
});

test('blueprints preserve totals, category ratios, HP and all non-blueprint types',t=>{
  const {file,deps}=fixture(t),before=rows(file,'master_jackal');
  for(const percent of [80,100,50,80]) {
    jackal.change(file,'blueprints',percent,deps);
    for(const row of rows(file,'master_jackal')) {
      const original=before.find(item=>item.type===row.type);
      if(!jackal.TYPES.includes(row.type)){assert.deepEqual(row,original);continue;}
      assert.equal(row.hp,original.hp);assert.equal(jackal.WEIGHTS.reduce((sum,col)=>sum+row[col],0),1000);
      assert.equal(row.drop_rmap_weapon_rate+row.drop_rmap_armor_rate,percent*10);
      assert.equal(row.drop_rmap_weapon_rate,percent*(row.type.length===8?2.5:2));
      if(percent===80) assert.deepEqual(jackal.WEIGHTS.map(col=>row[col]),row.type.length===8?[134,33,33,200,600,0,0]:[0,0,0,160,640,200,0]);
    }
  }
  jackal.change(file,'blueprints',null,deps);assert.deepEqual(rows(file,'master_jackal'),before);
});

for(const first of ['spawn','blueprints']) test(`independent options preserve unrelated writes: ${first} restored first`,t=>{
  const {file,deps}=fixture(t),beforeConst=rows(file,'master_const_int'),beforeJackal=rows(file,'master_jackal');
  const second=first==='spawn'?'blueprints':'spawn',values={spawn:10,blueprints:80};
  jackal.change(file,first,values[first],deps);jackal.change(file,second,values[second],deps);
  edit(file,'UPDATE unrelated SET value=777');
  jackal.change(file,first,null,deps);assert.equal(jackal.status(file,second).applied,true);
  jackal.change(file,second,null,deps);
  assert.deepEqual(rows(file,'master_const_int'),beforeConst);assert.deepEqual(rows(file,'master_jackal'),beforeJackal);
  assert.equal(rows(file,'unrelated')[0].value,777);
});

test('reject running game, invalid inputs, backup failure and conflicting records without mutation',t=>{
  const {file,deps}=fixture(t),bytes=fs.readFileSync(file);
  assert.throws(()=>jackal.change(file,'spawn',10,{...deps,isGameRunning:()=>true}),/종료/);
  for(const value of [0,301,1.5,NaN]) assert.throws(()=>jackal.change(file,'spawn',value,deps));
  assert.throws(()=>jackal.change(file,'blueprints',99,deps));
  assert.throws(()=>jackal.change(file,'spawn',10,{...deps,backup:()=>{throw Error('disk full');}}),/disk full/);
  assert.deepEqual(fs.readFileSync(file),bytes);
  jackal.change(file,'spawn',10,deps);edit(file,"UPDATE master_const_int SET value=12 WHERE id='JACKAL_AP_TIME_1'");
  const conflict=fs.readFileSync(file);
  assert.throws(()=>jackal.change(file,'spawn',null,deps),/기록/);assert.deepEqual(fs.readFileSync(file),conflict);
});

test('missing rows and invalid weight totals are rejected, trigger errors roll back all changes',t=>{
  const {file,deps}=fixture(t);
  edit(file,"DELETE FROM master_const_int WHERE id='JACKAL_AP_TIME_1'; UPDATE master_jackal SET drop_coin_rate=401 WHERE type='JACKAL_X'");
  const bytes=fs.readFileSync(file);
  assert.throws(()=>jackal.change(file,'spawn',10,deps),/목록/);
  assert.throws(()=>jackal.change(file,'blueprints',80,deps),/합계/);assert.deepEqual(fs.readFileSync(file),bytes);
  edit(file,"INSERT INTO master_const_int VALUES('JACKAL_AP_TIME_1',300); CREATE TRIGGER reject_spawn BEFORE UPDATE ON master_const_int WHEN NEW.id='JACKAL_AP_TIME_1' BEGIN SELECT RAISE(ABORT,'blocked update'); END");
  const before=rows(file,'master_const_int');
  assert.throws(()=>jackal.change(file,'spawn',10,deps),/blocked update/);
  assert.deepEqual(rows(file,'master_const_int'),before);assert.equal(jackal.status(file,'spawn').applied,false);
});

test('menu defaults, manual values and independent restoration route correctly',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../lid-kc.js'),'utf8'),calls=[];
  const context=vm.createContext({console:{log(){}},require:()=>({status:()=>({applied:true,rows:[]}),change:(...args)=>{calls.push(args);return {changed:false};}}),getMasterDatabasePath:()=>'/test.db',isGameRunning:()=>false,createMasterDatabaseBackup:()=>'/backup',confirm:async()=>true,fail:message=>{throw Error(message);}});
  vm.runInContext(source.slice(source.indexOf('async function manageJackalOption('),source.indexOf('function setCollisionMushroomThirtyMinutes(')),context);
  const rl={question:async()=>''};
  await context.manageJackalOption(rl,null,'spawn');await context.manageJackalOption(rl,null,'blueprints');
  await context.manageJackalOption(rl,null,'spawn',false,true,'5');await context.manageJackalOption(rl,null,'blueprints',true,true);
  assert.deepEqual(calls.map(args=>[args[1],args[2]]),[['spawn',10],['blueprints',80],['spawn',5],['blueprints',null]]);
  await assert.rejects(()=>context.manageJackalOption(rl,null,'spawn',false,true,'NaN'));
  await assert.rejects(()=>context.manageJackalOption(rl,null,'blueprints',false,true,'81'));
  assert.equal(calls.length,4);
});
