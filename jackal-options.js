'use strict';
const { message: tr } = require('./language');

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const MARKER = '_lid_multitool_jackal_v1';
const PREFIXES = ['JACKAL', 'JACKAL15', 'JACKAL20'];
const SPAWN_IDS = PREFIXES.flatMap(prefix=>[`${prefix}_AP_TIME_1`, `${prefix}_AP_PER_1`]).sort();
const TYPES = ['JACKAL_X','JACKAL_XXX','JACKAL_Y','JACKAL_YYY','JACKAL_Z','JACKAL_ZZZ'];
const WEIGHTS = ['drop_coin_rate','drop_part_weapon_rate','drop_part_armor_rate','drop_rmap_weapon_rate','drop_rmap_armor_rate','drop_item_1_rate','drop_item_2_rate'];
const equal = (a,b)=>JSON.stringify(a)===JSON.stringify(b);
function spec(feature) {
  if (feature==='spawn') return {table:'master_const_int',key:'id',keys:SPAWN_IDS,columns:['value']};
  if (feature==='blueprints') return {table:'master_jackal',key:'type',keys:TYPES,columns:WEIGHTS};
  throw new Error(tr(861));
}
function validateRows(feature,rows) {
  const {keys,key,columns}=spec(feature);
  if (!Array.isArray(rows) || rows.length!==keys.length || rows.some((row,i)=>!row || row[key]!==keys[i] || !equal(Object.keys(row).sort(),[key,...columns].sort()))) throw new Error(tr(862));
  for(const row of rows) {
    for(const col of columns) if(!Number.isSafeInteger(row[col]) || row[col]<0 || row[col]>100000) throw new Error(tr(863));
    if(feature==='spawn' && (row.id.endsWith('_TIME_1') ? row.value<1 || row.value>3600 : row.value>1000)) throw new Error(tr(864));
    if(feature==='blueprints' && (WEIGHTS.reduce((sum,col)=>sum+row[col],0)!==1000 || row.drop_rmap_weapon_rate+row.drop_rmap_armor_rate<=0)) throw new Error(tr(865));
  }
}
function rowsFrom(db,feature) {
  const {table,key,keys,columns}=spec(feature);
  const rows=db.prepare(`SELECT ${key},${columns.join(',')} FROM ${table} WHERE ${key} IN (${keys.map(()=>'?').join(',')}) ORDER BY ${key}`).all(...keys).map(row=>({...row}));
  validateRows(feature,rows);
  return rows;
}
function readState(db,feature) {
  const rows=rowsFrom(db,feature);
  let record=null;
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(MARKER)) {
    const stored=db.prepare(`SELECT original,patched FROM ${MARKER} WHERE feature=?`).get(feature);
    if(stored) {
      record={original:JSON.parse(stored.original),patched:JSON.parse(stored.patched)};
      validateRows(feature,record.original);validateRows(feature,record.patched);
      if(!equal(rows,record.patched)) throw new Error(tr(866));
    }
  }
  return {rows,record};
}
function allocate(values,total) {
  const sum=values.reduce((a,b)=>a+b,0);
  if(sum===0) {if(total!==0) throw new Error(tr(867));return values.map(()=>0);}
  const result=values.map(value=>Math.floor(value*total/sum));
  const order=values.map((value,i)=>({i,remainder:(value*total)%sum})).sort((a,b)=>b.remainder-a.remainder || a.i-b.i);
  const remaining=total-result.reduce((a,b)=>a+b,0);
  for(let i=0;i<remaining;i++) result[order[i].i]++;
  return result;
}
function targetRows(feature,original,value) {
  validateRows(feature,original);
  if(feature==='spawn') {
    if(!Number.isInteger(value) || value<1 || value>300) throw new Error(tr(868));
    return original.map(row=>({...row,value:row.id.endsWith('_TIME_1')?value:1000}));
  }
  if(![50,80,100].includes(value)) throw new Error(tr(869));
  return original.map(row=>{
    const result={...row};
    const bp=WEIGHTS.filter(col=>col.startsWith('drop_rmap_')), other=WEIGHTS.filter(col=>!bp.includes(col));
    for(const [cols,budget] of [[bp,value*10],[other,1000-value*10]]) {
      const values=allocate(cols.map(col=>row[col]),budget);
      cols.forEach((col,i)=>{result[col]=values[i];});
    }
    return result;
  });
}
function status(file,feature) {
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    const {rows,record}=readState(db,feature);
    return {feature,applied:!!record,rows};
  } finally{db.close();}
}
function change(file,feature,value,{isGameRunning,backup}) {
  if(isGameRunning()) throw new Error(tr(870));
  const restore=value===null;
  const inspect=new DatabaseSync(file,{readOnly:true});
  let state;
  try{state=readState(inspect,feature);}finally{inspect.close();}
  if(restore && !state.record) return {...status(file,feature),changed:false};
  const original=state.record?.original || state.rows;
  const target=restore ? original : targetRows(feature,original,value);
  if(!restore && equal(target,state.rows)) return {...status(file,feature),changed:false};
  const bytes=fs.readFileSync(file),backupPath=backup(bytes);
  if(!fs.readFileSync(file).equals(bytes)) throw new Error(tr(871));
  const db=new DatabaseSync(file);
  try {
    db.exec('BEGIN IMMEDIATE');
    if(!equal(readState(db,feature),state)) throw new Error(tr(872));
    const {table,key,columns}=spec(feature);
    const update=db.prepare(`UPDATE ${table} SET ${columns.map(col=>col+'=?').join(',')} WHERE ${key}=?`);
    for(const row of target) if(Number(update.run(...columns.map(col=>row[col]),row[key]).changes)!==1) throw new Error(tr(873));
    if(!equal(rowsFrom(db,feature),target)) throw new Error(tr(874));
    db.exec(`CREATE TABLE IF NOT EXISTS ${MARKER}(feature TEXT PRIMARY KEY,original TEXT NOT NULL,patched TEXT NOT NULL)`);
    if(restore) db.prepare(`DELETE FROM ${MARKER} WHERE feature=?`).run(feature);
    else db.prepare(`INSERT OR REPLACE INTO ${MARKER} VALUES(?,?,?)`).run(feature,JSON.stringify(original),JSON.stringify(target));
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw new Error(tr(852));
    db.exec('COMMIT');
  } catch(error){try{db.exec('ROLLBACK');}catch{} throw error;}
  finally{db.close();}
  return {...status(file,feature),changed:true,backupPath};
}
module.exports={SPAWN_IDS,TYPES,WEIGHTS,status,change,targetRows};
