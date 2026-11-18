'use strict';
// A fighter-limit backup is a whole DB image. Never let it replace a newer
// vanilla schema, Deathroid values or unrelated mods while undoing fighter data.
const fs=require('node:fs'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const FIGHTER_TABLES=new Set(['master_body_detail','master_bodylvl_status_value','master_bodylvl_exp']);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function refuse(reason){throw Error('Full fighter DB restore refused: '+reason+'. Use a matching current-build backup; no game file was changed. / 파이터 전체 DB 복원 중단: 새 게임 데이터 또는 다른 설정을 덮어쓸 수 있습니다. 현재 빌드의 일치하는 백업을 사용하세요.');}
function assertIdle(...files){for(const file of files)for(const suffix of ['-wal','-shm','-journal'])if(fs.existsSync(file+suffix))refuse('database in use or recovering');}
function tableHash(database,name){
 const rows=[],statement=database.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"');
 statement.setReadBigInts(true);
 for(const row of statement.all())rows.push(hash(JSON.stringify(row,(_,v)=>typeof v==='bigint'?{__sqlite_integer__:v.toString()}:v)));
 rows.sort();return hash(rows.join('\n'));
}
function assertCompatible(currentPath,backupPath){
 assertIdle(currentPath,backupPath);
 let current,backup;
 try{
  current=new DatabaseSync(currentPath,{readOnly:true});backup=new DatabaseSync(backupPath,{readOnly:true});
  for(const db of [current,backup])if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')refuse('database integrity check failed');
  const inventory=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const a=inventory(current),b=inventory(backup);if(JSON.stringify(a)!==JSON.stringify(b))refuse('schema differs from the installed database');
  for(const table of a.filter(row=>row.type==='table'&&!FIGHTER_TABLES.has(row.name))){
   if(/^CREATE\s+VIRTUAL\s+TABLE/i.test(table.sql||''))refuse('unreviewed virtual table');
   if(tableHash(current,table.name)!==tableHash(backup,table.name))refuse('unrelated table differs: '+table.name);
  }
  return true;
 }finally{if(backup)backup.close();if(current)current.close();}
}
module.exports={assertCompatible,assertIdle};
