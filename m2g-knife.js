'use strict';
const { message: tr } = require('./language');

const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const IDS=['ANI_CH_ATK_WP56_FF_Fire_03','ANI_CH_ATK_WP56_Fire_03'];
const MARKER='_lid_multitool_m2g_knife_v1';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validate(rows) {
  if(!Array.isArray(rows)||rows.length!==IDS.length||rows.some((row,i)=>!row||row.id!==IDS[i]||!equal(Object.keys(row).sort(),['id','scale'])||![100,200].includes(row.scale))) throw Error(tr(875));
}
function read(db) {
  const rows=db.prepare('SELECT id,scale FROM master_atk_scale WHERE id IN (?,?) ORDER BY id').all(...IDS).map(row=>({...row}));
  validate(rows);
  let record=null;
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(MARKER)) {
    const records=db.prepare(`SELECT original,patched FROM ${MARKER}`).all();
    if(records.length>1)throw Error(tr(876));
    if(records.length) {
      record={original:JSON.parse(records[0].original),patched:JSON.parse(records[0].patched)};
      validate(record.original);validate(record.patched);
      if(!equal(rows,record.patched)) throw Error(tr(877));
    }
  }
  return {rows,record};
}
function status(file) {
  const db=new DatabaseSync(file,{readOnly:true});
  try {const {rows,record}=read(db);return {rows,applied:!!record};}finally{db.close();}
}
function change(file,restore,{isGameRunning,backup}) {
  if(typeof restore!=='boolean')throw Error(tr(878));
  if(isGameRunning())throw Error(tr(879));
  const reader=new DatabaseSync(file,{readOnly:true});
  let state;try{state=read(reader);}finally{reader.close();}
  if(restore&&!state.record)return {...status(file),changed:false};
  const original=state.record?.original||state.rows;
  const target=restore?original:IDS.map(id=>({id,scale:200}));
  if(!restore&&equal(target,state.rows))return {...status(file),changed:false};
  // Fixed 100 -> 200 compensation, not repeated multiplication on each run.
  const bytes=fs.readFileSync(file),backupPath=backup(bytes);
  if(!fs.readFileSync(file).equals(bytes))throw Error(tr(871));
  if(isGameRunning())throw Error(tr(880));
  const db=new DatabaseSync(file);
  try {
    db.exec('BEGIN IMMEDIATE');
    if(!equal(read(db),state))throw Error(tr(881));
    const update=db.prepare('UPDATE master_atk_scale SET scale=? WHERE id=?');
    for(const row of target)if(Number(update.run(row.scale,row.id).changes)!==1)throw Error(tr(882));
    // Compare directly: the old marker is expected to differ until it is updated.
    const result=db.prepare('SELECT id,scale FROM master_atk_scale WHERE id IN (?,?) ORDER BY id').all(...IDS).map(row=>({...row}));
    if(!equal(result,target))throw Error(tr(883));
    db.exec(`CREATE TABLE IF NOT EXISTS ${MARKER}(id INTEGER PRIMARY KEY CHECK(id=1),original TEXT NOT NULL,patched TEXT NOT NULL)`);
    if(restore)db.exec(`DELETE FROM ${MARKER}`);
    else db.prepare(`INSERT OR REPLACE INTO ${MARKER} VALUES(1,?,?)`).run(JSON.stringify(original),JSON.stringify(target));
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error(tr(852));
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
  return {...status(file),changed:true,backupPath};
}
module.exports={IDS,status,change};
