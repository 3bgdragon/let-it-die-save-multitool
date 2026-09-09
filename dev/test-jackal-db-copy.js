'use strict';
// Read the supplied DB; every patch is made to a unique temporary COPY only.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const jackal=require('../jackal-options');
const source=path.resolve(process.argv[2]);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(fs.existsSync(source+'-wal')) throw Error('Close the DB writer and checkpoint WAL before testing a file copy.');
const originalBytes=fs.readFileSync(source),originalHash=hash(originalBytes);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lid-jackal-live-copy-')),file=path.join(dir,'masters.db');
fs.writeFileSync(file,originalBytes);
let backupCount=0;
const deps={isGameRunning:()=>false,backup:bytes=>{const dest=path.join(dir,`backup-${++backupCount}.bak`);fs.writeFileSync(dest,bytes);return dest;}};
function snapshot() {
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    const result={};
    for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_lid_multitool_jackal_v1' ORDER BY name").all()) {
      const rows=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all();
      result[name]=rows.map(row=>JSON.stringify(row)).sort();
    }
    return result;
  }finally{db.close();}
}
try {
  const before=snapshot();
  jackal.change(file,'spawn',10,deps);jackal.change(file,'blueprints',80,deps);
  const after=snapshot();
  assert.deepEqual(Object.keys(after),Object.keys(before));
  for(const table of Object.keys(before)) {
    if(!['master_const_int','master_jackal'].includes(table)){assert.deepEqual(after[table],before[table],table);continue;}
    const key=table==='master_const_int'?'id':'type',initial=before[table].map(JSON.parse),changed=after[table].map(JSON.parse);
    assert.equal(initial.length,changed.length);
    let count=0;
    for(const row of changed) {
      const old=initial.find(item=>item[key]===row[key]);assert.ok(old);
      const selected=table==='master_const_int'?jackal.SPAWN_IDS.includes(row.id):jackal.TYPES.includes(row.type);
      if(!selected){assert.deepEqual(row,old);continue;}
      count++;
      if(table==='master_const_int') assert.deepEqual(row,{...old,value:row.id.endsWith('_TIME_1')?10:1000});
      else {
        assert.equal(row.drop_rmap_weapon_rate+row.drop_rmap_armor_rate,800);
        assert.equal(jackal.WEIGHTS.reduce((sum,col)=>sum+row[col],0),1000);
        const preserved={...row};for(const col of jackal.WEIGHTS)preserved[col]=old[col];assert.deepEqual(preserved,old);
      }
    }
    assert.equal(count,6);
  }
  jackal.change(file,'spawn',null,deps);assert.equal(jackal.status(file,'blueprints').applied,true);
  jackal.change(file,'blueprints',null,deps);assert.deepEqual(snapshot(),before);
  assert.equal(hash(fs.readFileSync(source)),originalHash);
  console.log(JSON.stringify({passed:true,tablesChecked:Object.keys(before).length,spawnRows:6,blueprintRows:6,backupCount,originalHash,liveDatabaseUnchanged:true,copyDirectory:dir},null,2));
} finally {
  assert.equal(hash(fs.readFileSync(source)),originalHash,'Source DB changed during test');
  // Keep this explicitly reported test copy and its backups for inspection.
}
