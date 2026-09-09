'use strict';
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
// Only the base costs: preserve the growth coefficient and step interval.
const COLUMNS = ['craft_spirit', 'lvup_spirit'];
function readRows(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(master_part_research)').all().map(row=>row.name));
  if (['ptid', ...COLUMNS].some(name=>!columns.has(name))) throw new Error('장비 스피리튬 DB 구조가 예상과 다릅니다.');
  const rows = db.prepare('SELECT ptid, craft_spirit, lvup_spirit FROM master_part_research ORDER BY ptid').all();
  if (!rows.length || new Set(rows.map(row=>row.ptid)).size!==rows.length || rows.some(row=>typeof row.ptid!=='string' || COLUMNS.some(key=>row[key]!==null && (!Number.isSafeInteger(row[key]) || row[key]<0 || row[key]>2147483647)))) {
    throw new Error('장비 스피리튬 비용 정의가 비었거나 유효하지 않습니다.');
  }
  return rows;
}
function status(databasePath) {
  const db = new DatabaseSync(databasePath,{readOnly:true});
  try {
    const rows = readRows(db);
    return {databasePath,rows,rowCount:rows.length,nonZeroRows:rows.filter(row=>COLUMNS.some(key=>row[key]>0)).length};
  } finally {db.close();}
}
function change(databasePath, sourcePath, {isGameRunning,backup}) {
  if (isGameRunning()) throw new Error('게임을 완전히 종료한 뒤 장비 스피리튬 비용을 변경하세요.');
  const current = status(databasePath);
  const target = sourcePath ? status(sourcePath).rows : current.rows.map(row=>({...row,craft_spirit:row.craft_spirit===null?null:0,lvup_spirit:row.lvup_spirit===null?null:0}));
  if (current.rows.length!==target.length || current.rows.some((row,i)=>row.ptid!==target[i].ptid)) throw new Error('현재 DB와 백업의 장비 목록이 달라 복원을 중단했습니다.');
  if (JSON.stringify(current.rows)===JSON.stringify(target)) return {...current,changed:false};
  const bytes = fs.readFileSync(databasePath),backupPath = backup(bytes);
  if (!fs.readFileSync(databasePath).equals(bytes)) throw new Error('백업 중 DB가 변경됐습니다. 중단했습니다.');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('BEGIN IMMEDIATE');
    if (JSON.stringify(readRows(db))!==JSON.stringify(current.rows)) throw new Error('스피리튬 비용을 읽은 뒤 DB가 변경됐습니다.');
    const update = db.prepare('UPDATE master_part_research SET craft_spirit=?,lvup_spirit=? WHERE ptid=?');
    for (const row of target) if (Number(update.run(row.craft_spirit,row.lvup_spirit,row.ptid).changes)!==1) throw new Error(`스피리튬 비용 수정 건수가 다릅니다: ${row.ptid}`);
    if (JSON.stringify(readRows(db))!==JSON.stringify(target)) throw new Error('스피리튬 비용 결과 검증 실패');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw new Error('DB 무결성 검증 실패');
    db.exec('COMMIT');
  } catch(error) {try{db.exec('ROLLBACK');}catch{} throw error;}
  finally {db.close();}
  return {...status(databasePath),changed:true,backupPath,sourcePath};
}
module.exports={status,setFree:(file,deps)=>change(file,null,deps),restore:(file,source,deps)=>{
  if (!source) throw new Error('복원할 스피리튬 전용 백업을 지정하세요.');
  return change(file,source,deps);
}};
