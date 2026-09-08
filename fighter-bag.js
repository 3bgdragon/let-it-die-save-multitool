'use strict';
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const TABLE = '_lid_multitool_bag_expansion_v1';
const EXTRA = 50;
const TYPES = ['BAL', 'BRE', 'COL', 'DEF', 'LUK', 'SHT', 'SKI', 'TEC'];

function snapshot(db, type) {
  const details = db.prepare('SELECT limit_break,bag_capacity FROM master_body_detail WHERE type=? AND grade=6 ORDER BY limit_break').all(type);
  const rows = db.prepare('SELECT lvl,bag FROM master_bodylvl_status_value WHERE type=? AND grade=6 ORDER BY lvl').all(type);
  if (details.length !== 5 || details.some((r,i) => r.limit_break !== i || !Number.isSafeInteger(r.bag_capacity) || r.bag_capacity <= 0) ||
      !rows.length || new Set(rows.map(r=>r.lvl)).size !== rows.length || rows.some(r=>!Number.isSafeInteger(r.bag) || r.bag < 0)) {
    throw new Error('6성 가방 DB 형식이 예상과 다릅니다. 변경하지 않습니다.');
  }
  return { details, rows };
}

function marker(db, type) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(TABLE)) return null;
  const row = db.prepare(`SELECT original FROM ${TABLE} WHERE type=?`).get(type);
  return row ? JSON.parse(row.original) : null;
}

function expanded(original) {
  if (original.details.some(r=>r.bag_capacity > 2147483647 - EXTRA) || original.rows.some(r=>r.bag > 2147483647 - EXTRA)) {
    throw new Error('가방 +50 적용값이 정수 저장 범위를 초과합니다.');
  }
  return {
    details: original.details.map(r=>({...r, bag_capacity:r.bag_capacity + EXTRA})),
    rows: original.rows.map(r=>({...r, bag:r.bag > 0 ? r.bag + EXTRA : 0})),
  };
}

function readState(db, type) {
  if (!TYPES.includes(type)) throw new Error('가방 확장은 지원되는 6성 클래스에만 적용할 수 있습니다.');
  const current = snapshot(db, type), original = marker(db, type);
  if (original) {
    // Stat expansion may add zero bag rows; never overwrite unrelated new DB data.
    const expected = expanded(original);
    if (JSON.stringify(current.details) !== JSON.stringify(expected.details) ||
        expected.rows.some(r=>current.rows.find(c=>c.lvl===r.lvl)?.bag !== r.bag) ||
        current.rows.some(r=>!expected.rows.some(e=>e.lvl===r.lvl) && r.bag !== 0)) {
      throw new Error('가방 패치 기록과 현재 DB가 다릅니다. 자동 변경을 중단했습니다.');
    }
  }
  return {current, original, applied:!!original};
}

function getStatus(databasePath, type) {
  const db = new DatabaseSync(databasePath,{readOnly:true});
  try {
    const state = readState(db,type);
    return {applied:state.applied, extra:state.applied ? EXTRA : 0,
      maximum:state.current.details.at(-1).bag_capacity,
      originalMaximum:(state.original || state.current).details.at(-1).bag_capacity};
  } finally {db.close();}
}

function setExpansion(databasePath, type, enabled, {isGameRunning, backup}) {
  if (isGameRunning()) throw new Error('게임을 완전히 종료한 뒤 가방 DB를 변경하세요.');
  const status = getStatus(databasePath,type);
  if (status.applied === enabled) return {...status,changed:false};
  const bytes = fs.readFileSync(databasePath), backupPath = backup(bytes);
  if (!fs.readFileSync(databasePath).equals(bytes)) throw new Error('백업 중 DB가 변경됐습니다. 중단했습니다.');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('BEGIN IMMEDIATE');
    const state = readState(db,type);
    if (state.applied !== status.applied) throw new Error('가방 패치 상태가 변경됐습니다.');
    const baseline = state.original || state.current;
    const target = enabled ? expanded(baseline) : baseline;
    const detailUpdate = db.prepare('UPDATE master_body_detail SET bag_capacity=? WHERE type=? AND grade=6 AND limit_break=?');
    const rowUpdate = db.prepare('UPDATE master_bodylvl_status_value SET bag=? WHERE type=? AND grade=6 AND lvl=?');
    for (const row of target.details) if (Number(detailUpdate.run(row.bag_capacity,type,row.limit_break).changes)!==1) throw new Error('가방 단계 수정 건수가 다릅니다.');
    for (const row of target.rows) if (Number(rowUpdate.run(row.bag,type,row.lvl).changes)!==1) throw new Error('가방 용량 수정 건수가 다릅니다.');
    db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE}(type TEXT PRIMARY KEY,original TEXT NOT NULL)`);
    if (enabled) db.prepare(`INSERT INTO ${TABLE}(type,original) VALUES(?,?)`).run(type,JSON.stringify(baseline));
    else db.prepare(`DELETE FROM ${TABLE} WHERE type=?`).run(type);
    const verified = snapshot(db,type);
    if (JSON.stringify(verified.details)!==JSON.stringify(target.details) || target.rows.some(r=>verified.rows.find(c=>c.lvl===r.lvl)?.bag!==r.bag)) throw new Error('가방 결과 검증 실패');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw new Error('DB 무결성 검증 실패');
    db.exec('COMMIT');
  } catch(error) {try {db.exec('ROLLBACK');} catch {} throw error;}
  finally {db.close();}
  return {...getStatus(databasePath,type),changed:true,backupPath};
}
module.exports={getStatus,setExpansion};
