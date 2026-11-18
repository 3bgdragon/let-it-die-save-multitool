'use strict';
// Opt-in offline compatibility test. Never locates or modifies a live installation.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const fixture=process.env.LID_SAVE_BUILD26639365_DB;
const EXPECTED='db9a81a1eb05036eb7171a993958d17a048889491fb2326cd5d686e8e010fd7a';
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function read(file,fn){const db=new DatabaseSync(file,{readOnly:true});try{return fn(db);}finally{db.close();}}
function protectedRows(file){return read(file,db=>JSON.stringify(['master_item','master_automaticshop_lineup','master_automaticshop_schedule'].map(table=>({table,sql:db.prepare('SELECT sql FROM sqlite_schema WHERE type=\'table\' AND name=?').get(table).sql,rows:db.prepare('SELECT * FROM "'+table+'" ORDER BY 1,2').all()}))));}
test('26639365 vanilla Deathroid SPLithium column and increased prices remain recognized',{skip:!fixture},()=>{
 assert.equal(sha(fixture),EXPECTED,'Use an acquired clean build-26639365 DB snapshot');
 read(fixture,db=>{
  const column=db.prepare('PRAGMA table_info(master_item)').all().find(r=>r.name==='sell_spirit');assert.ok(column);assert.equal(column.type,'INTEGER');assert.equal(column.notnull,1);
  const rows=db.prepare("SELECT itemid,sell_money,sell_spirit FROM master_item WHERE itemid GLOB 'ITMT_STEROID_[1-6]' ORDER BY itemid").all();
  assert.deepEqual(rows.map(r=>[r.itemid,r.sell_money,r.sell_spirit]),[2000,4000,8000,12000,18000,24000].map((price,i)=>['ITMT_STEROID_'+(i+1),price,price*2]));
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 });
});
test('26639365 DB options preserve all vanilla item/shop rows during edits and restoration',{skip:!fixture},t=>{
 assert.equal(sha(fixture),EXPECTED);const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lid-save-build26639365-'));
 t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('lid-save-build26639365-'));fs.rmSync(directory,{recursive:true,force:true});assert.equal(sha(fixture),EXPECTED);});
 const baseline=protectedRows(fixture);let sequence=0;
 const deps={isGameRunning:()=>false,backup:bytes=>{const file=path.join(directory,'backup-'+(++sequence)+'.db');fs.writeFileSync(file,bytes,{flag:'wx'});return file;}};
 for(const feature of ['spirit','bag','jackal-spawn','jackal-blueprint','m2g']){
  const file=path.join(directory,feature+'.db');fs.copyFileSync(fixture,file,fs.constants.COPYFILE_EXCL);
  if(feature==='spirit'){const m=require('../equipment-spirit'),r=m.setFree(file,deps);assert.ok(r.changed);assert.equal(protectedRows(file),baseline);m.restore(file,r.backupPath,deps);}
  else if(feature==='bag'){const m=require('../fighter-bag');for(const type of ['BAL','BRE','COL','DEF','LUK','SHT','SKI','TEC']){assert.ok(m.setExpansion(file,type,true,deps).changed);assert.equal(protectedRows(file),baseline);m.setExpansion(file,type,false,deps);}}
  else if(feature.startsWith('jackal-')){const m=require('../jackal-options'),key=feature==='jackal-spawn'?'spawn':'blueprints';assert.ok(m.change(file,key,key==='spawn'?10:80,deps).changed);assert.equal(protectedRows(file),baseline);m.change(file,key,null,deps);}
  else{const m=require('../m2g-knife');assert.ok(m.change(file,false,deps).changed);assert.equal(protectedRows(file),baseline);m.change(file,true,deps);}
  assert.equal(protectedRows(file),baseline);read(file,db=>assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok'));
 }
});
