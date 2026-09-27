'use strict';
const { message: tr } = require('./language');

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
// Only the base costs: preserve the growth coefficient and step interval.
const COLUMNS = ['craft_spirit', 'lvup_spirit'];
function readRows(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(master_part_research)').all().map(row=>row.name));
  if (['ptid', ...COLUMNS].some(name=>!columns.has(name))) throw new Error(tr(853));
  const rows = db.prepare('SELECT ptid, craft_spirit, lvup_spirit FROM master_part_research ORDER BY ptid').all();
  if (!rows.length || new Set(rows.map(row=>row.ptid)).size!==rows.length || rows.some(row=>typeof row.ptid!=='string' || COLUMNS.some(key=>row[key]!==null && (!Number.isSafeInteger(row[key]) || row[key]<0 || row[key]>2147483647)))) {
    throw new Error(tr(854));
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
  if (isGameRunning()) throw new Error(tr(855));
  const current = status(databasePath);
  const target = sourcePath ? status(sourcePath).rows : current.rows.map(row=>({...row,craft_spirit:row.craft_spirit===null?null:0,lvup_spirit:row.lvup_spirit===null?null:0}));
  if (current.rows.length!==target.length || current.rows.some((row,i)=>row.ptid!==target[i].ptid)) throw new Error(tr(856));
  if (JSON.stringify(current.rows)===JSON.stringify(target)) return {...current,changed:false};
  const bytes = fs.readFileSync(databasePath),backupPath = backup(bytes);
  if (!fs.readFileSync(databasePath).equals(bytes)) throw new Error(tr(847));
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('BEGIN IMMEDIATE');
    if (JSON.stringify(readRows(db))!==JSON.stringify(current.rows)) throw new Error(tr(857));
    const update = db.prepare('UPDATE master_part_research SET craft_spirit=?,lvup_spirit=? WHERE ptid=?');
    for (const row of target) if (Number(update.run(row.craft_spirit,row.lvup_spirit,row.ptid).changes)!==1) throw new Error(tr(858, row.ptid));
    if (JSON.stringify(readRows(db))!==JSON.stringify(target)) throw new Error(tr(859));
    if (db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw new Error(tr(852));
    db.exec('COMMIT');
  } catch(error) {try{db.exec('ROLLBACK');}catch{} throw error;}
  finally {db.close();}
  return {...status(databasePath),changed:true,backupPath,sourcePath};
}
module.exports={status,setFree:(file,deps)=>change(file,null,deps),restore:(file,source,deps)=>{
  if (!source) throw new Error(tr(860));
  return change(file,source,deps);
}};
