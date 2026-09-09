'use strict';
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const IDS=['ANI_CH_ATK_WP56_FF_Fire_03','ANI_CH_ATK_WP56_Fire_03'];
const MARKER='_lid_multitool_m2g_knife_v1';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validate(rows) {
  if(!Array.isArray(rows)||rows.length!==IDS.length||rows.some((row,i)=>!row||row.id!==IDS[i]||!equal(Object.keys(row).sort(),['id','scale'])||![100,200].includes(row.scale))) throw Error('M2G 나이프 DB 형식 또는 배율이 예상(100/200)과 다릅니다. 덮어쓰지 않고 중단했습니다.');
}
function read(db) {
  const rows=db.prepare('SELECT id,scale FROM master_atk_scale WHERE id IN (?,?) ORDER BY id').all(...IDS).map(row=>({...row}));
  validate(rows);
  let record=null;
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(MARKER)) {
    const records=db.prepare(`SELECT original,patched FROM ${MARKER}`).all();
    if(records.length>1)throw Error('M2G 복원 기록이 중복됐습니다.');
    if(records.length) {
      record={original:JSON.parse(records[0].original),patched:JSON.parse(records[0].patched)};
      validate(record.original);validate(record.patched);
      if(!equal(rows,record.patched)) throw Error('M2G 패치 기록과 현재 배율이 다릅니다. 덮어쓰지 않고 중단했습니다.');
    }
  }
  return {rows,record};
}
function status(file) {
  const db=new DatabaseSync(file,{readOnly:true});
  try {const {rows,record}=read(db);return {rows,applied:!!record};}finally{db.close();}
}
function change(file,restore,{isGameRunning,backup}) {
  if(typeof restore!=='boolean')throw Error('M2G 적용/복원 모드가 올바르지 않습니다.');
  if(isGameRunning())throw Error('게임을 완전히 종료한 뒤 변경하세요.');
  const reader=new DatabaseSync(file,{readOnly:true});
  let state;try{state=read(reader);}finally{reader.close();}
  if(restore&&!state.record)return {...status(file),changed:false};
  const original=state.record?.original||state.rows;
  const target=restore?original:IDS.map(id=>({id,scale:200}));
  if(!restore&&equal(target,state.rows))return {...status(file),changed:false};
  // Fixed 100 -> 200 compensation, not repeated multiplication on each run.
  const bytes=fs.readFileSync(file),backupPath=backup(bytes);
  if(!fs.readFileSync(file).equals(bytes))throw Error('백업 중 DB가 변경됐습니다.');
  if(isGameRunning())throw Error('백업 중 게임이 실행됐습니다. 게임을 종료하세요.');
  const db=new DatabaseSync(file);
  try {
    db.exec('BEGIN IMMEDIATE');
    if(!equal(read(db),state))throw Error('작업 중 M2G DB가 변경됐습니다.');
    const update=db.prepare('UPDATE master_atk_scale SET scale=? WHERE id=?');
    for(const row of target)if(Number(update.run(row.scale,row.id).changes)!==1)throw Error('M2G 수정 건수가 다릅니다.');
    // Compare directly: the old marker is expected to differ until it is updated.
    const result=db.prepare('SELECT id,scale FROM master_atk_scale WHERE id IN (?,?) ORDER BY id').all(...IDS).map(row=>({...row}));
    if(!equal(result,target))throw Error('M2G 결과 검증 실패');
    db.exec(`CREATE TABLE IF NOT EXISTS ${MARKER}(id INTEGER PRIMARY KEY CHECK(id=1),original TEXT NOT NULL,patched TEXT NOT NULL)`);
    if(restore)db.exec(`DELETE FROM ${MARKER}`);
    else db.prepare(`INSERT OR REPLACE INTO ${MARKER} VALUES(1,?,?)`).run(JSON.stringify(original),JSON.stringify(target));
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('DB 무결성 검증 실패');
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
  return {...status(file),changed:true,backupPath};
}
module.exports={IDS,status,change};
