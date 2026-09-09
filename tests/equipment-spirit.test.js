'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const spirit=require('../equipment-spirit');
const source=fs.readFileSync(path.join(__dirname,'../lid-kc.js'),'utf8');
const materialDeclaration=source.match(/const EQUIPMENT_MATERIAL_COLUMNS = \[[\s\S]*?\];/)[0];
const columns=vm.runInNewContext(materialDeclaration+'\nArray.from(EQUIPMENT_MATERIAL_COLUMNS)');

function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lid-spirit-test-'));
 t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('lid-spirit-test-'));fs.rmSync(dir,{recursive:true,force:true});});
 const file=path.join(dir,'masters.db'),db=new DatabaseSync(file);
 db.exec(`CREATE TABLE master_part_research(ptid TEXT PRIMARY KEY,craft_spirit INTEGER,lvup_spirit INTEGER,lvup_spirit_c REAL,lvup_spirit_add_lv INTEGER,craft_money INTEGER,lvup_money INTEGER,init_waiting_minute INTEGER,mate1_id TEXT,${columns.map(key=>key+' REAL').join(',')}); CREATE TABLE unrelated(value INTEGER); INSERT INTO unrelated VALUES(123);`);
 const insert=db.prepare(`INSERT INTO master_part_research VALUES(${Array.from({length:9+columns.length},()=>'?').join(',')})`);
 insert.run('A',5,25000,1.44,1,500,700,60,'materialA',...columns.map(()=>2));
 insert.run('B',0,0,1.05,2,0,0,0,'materialB',...columns.map(()=>0));
 insert.run('C',null,null,null,null,null,null,0,'materialC',...columns.map(()=>null));
 db.close();
 let backupCount=0;
 const backup=bytes=>{const name=path.join(dir,`backup-${++backupCount}.bak`);fs.writeFileSync(name,bytes);return name;};
 const deps={isGameRunning:()=>false,backup};
 const context=vm.createContext({fs,path,Buffer,DatabaseSync,getMasterDatabasePath:()=>file,isGameRunning:()=>false,
  sha256:bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),createMasterDatabaseBackup:backup,
  backupDirectory:()=>dir,EQUIPMENT_MATERIAL_BACKUP_PREFIX:'unused.',fail:msg=>{throw Error(msg);}});
 vm.runInContext(materialDeclaration+'\n'+source.slice(source.indexOf('function assertEquipmentMaterialSchema('),source.indexOf('function listEquipmentSpiritBackups(')),context);
 return {file,deps,materials:context,backups:()=>backupCount};
}
function all(file) {
 const db=new DatabaseSync(file,{readOnly:true});
 try{return db.prepare('SELECT * FROM master_part_research ORDER BY ptid').all().map(row=>({...row}));}finally{db.close();}
}

test('SP-only changes two base costs, preserves NULLs, coefficients, materials and backup',t=>{
 const {file,deps,backups}=fixture(t),before=all(file),bytes=fs.readFileSync(file);
 const result=spirit.setFree(file,deps);
 assert.equal(result.nonZeroRows,0);assert.equal(result.changed,true);
 assert.deepEqual(fs.readFileSync(result.backupPath),bytes);
 assert.deepEqual(all(file),before.map(row=>({...row,craft_spirit:row.craft_spirit===null?null:0,lvup_spirit:row.lvup_spirit===null?null:0})));
 assert.equal(spirit.setFree(file,deps).changed,false);assert.equal(backups(),1);
 const db=new DatabaseSync(file);db.exec('UPDATE unrelated SET value=999');db.close();
 spirit.restore(file,result.backupPath,deps);assert.deepEqual(all(file),before);
 const check=new DatabaseSync(file,{readOnly:true});try{assert.equal(check.prepare('SELECT value FROM unrelated').get().value,999);}finally{check.close();}
});

for(const materialFirst of [true,false]) test(`material and SP options restore independently (material first=${materialFirst})`,t=>{
 const {file,deps,materials}=fixture(t),before=all(file);
 let m,s;
 if(materialFirst){m=materials.setEquipmentMaterialsFree(null);s=spirit.setFree(file,deps);}
 else{s=spirit.setFree(file,deps);m=materials.setEquipmentMaterialsFree(null);}
 assert.equal(all(file)[0].craft_mate1_num,0);assert.equal(all(file)[0].lvup_spirit,0);
 if(materialFirst){
  materials.restoreEquipmentMaterials(null,m.backupPath);
  assert.equal(all(file)[0].craft_mate1_num,2);assert.equal(all(file)[0].lvup_spirit,0);
  spirit.restore(file,s.backupPath,deps);
 }else{
  spirit.restore(file,s.backupPath,deps);
  assert.equal(all(file)[0].craft_mate1_num,0);assert.equal(all(file)[0].lvup_spirit,25000);
  materials.restoreEquipmentMaterials(null,m.backupPath);
 }
 assert.deepEqual(all(file),before);
});

test('SP guards running game, failed backup, schema mismatch and rolls back SQL errors',t=>{
 const {file,deps}=fixture(t),bytes=fs.readFileSync(file);
 assert.throws(()=>spirit.setFree(file,{...deps,isGameRunning:()=>true}),/종료/);
 assert.throws(()=>spirit.setFree(file,{...deps,backup:()=>{throw Error('backup failed');}}),/backup failed/);
 assert.deepEqual(fs.readFileSync(file),bytes);
 const db=new DatabaseSync(file);db.exec("CREATE TRIGGER stop_update BEFORE UPDATE ON master_part_research WHEN NEW.ptid='B' BEGIN SELECT RAISE(ABORT,'test rollback'); END;");db.close();
 const before=all(file);assert.throws(()=>spirit.setFree(file,deps),/rollback/);assert.deepEqual(all(file),before);
 const broken=new DatabaseSync(file);broken.exec('DROP TRIGGER stop_update; ALTER TABLE master_part_research RENAME COLUMN craft_spirit TO unexpected;');broken.close();
 assert.throws(()=>spirit.setFree(file,deps),/구조/);
});

test('SP restore rejects changed equipment lists without changing DB',t=>{
 const {file,deps}=fixture(t),result=spirit.setFree(file,deps);
 const db=new DatabaseSync(file);db.exec("DELETE FROM master_part_research WHERE ptid='B'");db.close();
 const bytes=fs.readFileSync(file);
 assert.throws(()=>spirit.restore(file,result.backupPath,deps),/장비 목록/);
 assert.deepEqual(fs.readFileSync(file),bytes);
});
