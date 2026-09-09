'use strict';
// All writes go to a unique temporary copy, never to the supplied source DB.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const m2g=require('../m2g-knife');
if(!process.argv[2])throw Error('Usage: node dev/test-m2g-db-copy.js <masters.db>');
const source=path.resolve(process.argv[2]),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(fs.existsSync(source+'-wal'))throw Error('Close the writer and checkpoint WAL before testing a file copy.');
const original=fs.readFileSync(source),originalHash=hash(original);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lid-m2g-live-copy-')),file=path.join(dir,'masters.db');
fs.writeFileSync(file,original);
let backups=0;
const deps={isGameRunning:()=>false,backup:bytes=>{const dest=path.join(dir,`backup-${++backups}.bak`);fs.writeFileSync(dest,bytes);return dest;}};
function snapshot(){
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='_lid_multitool_m2g_knife_v1' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort()]));
  }finally{db.close();}
}
try {
  const before=snapshot();
  assert.equal(m2g.status(file).applied,false,'Use a DB without an existing M2G patch record');
  assert.ok(m2g.status(file).rows.every(row=>row.scale===100),'Baseline knife scales must be 100 for this integration test');
  const applied=m2g.change(file,false,deps);assert.deepEqual(fs.readFileSync(applied.backupPath),original);
  const after=snapshot();assert.deepEqual(Object.keys(after),Object.keys(before));
  for(const name of Object.keys(before)) {
    if(name!=='master_atk_scale'){assert.deepEqual(after[name],before[name],name);continue;}
    const expected=before[name].map(JSON.parse).map(row=>JSON.stringify(m2g.IDS.includes(row.id)?{...row,scale:200}:row)).sort();
    assert.deepEqual(after[name],expected);
  }
  assert.equal(m2g.change(file,false,deps).changed,false);assert.equal(backups,1);
  m2g.change(file,true,deps);assert.deepEqual(snapshot(),before);
  assert.equal(m2g.status(file).applied,false);
  assert.equal(hash(fs.readFileSync(source)),originalHash);
  console.log(JSON.stringify({passed:true,tablesChecked:Object.keys(before).length,changedCells:2,backupCount:backups,originalHash,liveDatabaseUnchanged:true,copyDirectory:dir},null,2));
}finally{assert.equal(hash(fs.readFileSync(source)),originalHash,'Source DB changed during test');}
