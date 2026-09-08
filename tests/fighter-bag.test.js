'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const bag=require('../fighter-bag');
const model=require('../fighter-model');

function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lid-bag-test-'));
 t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('lid-bag-test-')); fs.rmSync(dir,{recursive:true,force:true});});
 const file=path.join(dir,'masters.db'), db=new DatabaseSync(file);
 db.exec('CREATE TABLE master_body_detail(type TEXT,grade INTEGER,limit_break INTEGER,param_lv_max INTEGER,skill_slots TEXT,bag_capacity INTEGER,rage_capacity INTEGER); CREATE TABLE master_bodylvl_status_value(type TEXT,grade INTEGER,limit_break INTEGER,lvl INTEGER,hp INTEGER,str INTEGER,dex INTEGER,vit INTEGER,stm INTEGER,luk INTEGER,skill INTEGER,bag INTEGER,rage INTEGER); CREATE TABLE master_bodylvl_exp(grade INTEGER,lvl INTEGER); CREATE TABLE unrelated(val INTEGER); INSERT INTO unrelated VALUES(30);');
 for (const type of ['BAL','COL']) {
  const base=type==='BAL'?24:42;
  for(let lb=0;lb<=4;lb++) db.prepare('INSERT INTO master_body_detail VALUES(?,6,?,?,?,?,5)').run(type,lb,lb===4?50:25+lb*5,Array.from({length:5+lb},(_,i)=>i+1).join(','),base+lb*3);
  for(let lvl=1;lvl<=50;lvl++) {
   const lb=lvl<=25?0:Math.min(4,Math.floor((lvl-26)/5)+1);
   const skill=lvl<=25?5:([26,31,36,41].includes(lvl)?5+lb:0);
   const capacity=lvl<=25?base:(lvl<=43 && (lvl-26)%5<3?base+(lb-1)*3+1+(lvl-26)%5:0);
   db.prepare('INSERT INTO master_bodylvl_status_value VALUES(?,6,?,?,100,10,10,10,10,10,?,?,?)').run(type,lb,lvl,skill,capacity,skill?5:0);
  }
 }
 db.exec("INSERT INTO master_body_detail VALUES('BAL',5,0,21,'1,2,3,4,5',20,3); INSERT INTO master_bodylvl_status_value VALUES('BAL',5,0,1,100,10,10,10,10,10,5,20,3)");
 for(let lvl=1;lvl<=500;lvl++) db.prepare('INSERT INTO master_bodylvl_exp VALUES(6,?)').run(lvl);
 db.close();
 let backups=0;
 const deps={isGameRunning:()=>false,backup:bytes=>{const backupFile=path.join(dir,`backup-${++backups}.db`);fs.writeFileSync(backupFile,bytes);return backupFile;}};
 return {file,deps,backups:()=>backups};
}
const fighter={type:'BAL',grade:6,stats:{hp:50,str:50,dex:50,vit:50,stm:50,luk:50,bag:12,skill:4,rage:0,hp_bonus:5,str_bonus:5,dex_bonus:5,vit_bonus:5,stm_bonus:5,luk_bonus:5}};

test('bag adds actual 50 slots without changing any level conversion; restore preserves unrelated DB writes',t=>{
 const {file,deps,backups}=fixture(t), original=fs.readFileSync(file);
 const before=model.readFighterLimits(file,fighter);
 const result=bag.setExpansion(file,'BAL',true,deps);
 assert.equal(result.maximum,86);assert.deepEqual(fs.readFileSync(result.backupPath),original);
 const after=model.readFighterLimits(file,fighter);
 assert.deepEqual(after.extraMaxima,before.extraMaxima);assert.deepEqual(after.maxima,before.maxima);
 for(let count=0;count<=12;count++) {
  assert.equal(model.paramLevel(after.details,'bag',count),model.paramLevel(before.details,'bag',count));
  const stats={...fighter.stats,bag:count};
  assert.equal(model.inspectFighter(after,stats).bag,model.inspectFighter(before,stats).bag+50);
 }
 const state=model.validateFighterStatUpdates(file,fighter,{});
 assert.equal(state.bag,86);assert.equal(state.slots,9);assert.equal(state.limitBreak,4);
 assert.equal(bag.setExpansion(file,'BAL',true,deps).changed,false);assert.equal(backups(),1);
 const db=new DatabaseSync(file);
 assert.equal(db.prepare("SELECT bag FROM master_bodylvl_status_value WHERE type='BAL' AND grade=6 AND lvl=50").get().bag,0);
 assert.equal(db.prepare("SELECT bag_capacity FROM master_body_detail WHERE type='COL' AND grade=6 AND limit_break=4").get().bag_capacity,54);
 assert.equal(db.prepare("SELECT bag_capacity FROM master_body_detail WHERE type='BAL' AND grade=5").get().bag_capacity,20);
 db.exec("UPDATE unrelated SET val=999; UPDATE master_bodylvl_status_value SET hp=222 WHERE type='BAL' AND grade=6 AND lvl=50");db.close();
 assert.equal(bag.setExpansion(file,'BAL',false,deps).maximum,36);
 const check=new DatabaseSync(file,{readOnly:true});
 try{assert.equal(check.prepare('SELECT val FROM unrelated').get().val,999);assert.equal(check.prepare("SELECT hp FROM master_bodylvl_status_value WHERE type='BAL' AND grade=6 AND lvl=50").get().hp,222);}finally{check.close();}
 assert.equal(bag.setExpansion(file,'BAL',false,deps).changed,false);
});

test('bag blocks running game, failed backup and conflicting metadata without writes',t=>{
 const {file,deps}=fixture(t), original=fs.readFileSync(file);
 assert.throws(()=>bag.setExpansion(file,'BAL',true,{...deps,isGameRunning:()=>true}),/종료/);
 assert.throws(()=>bag.setExpansion(file,'BAL',true,{...deps,backup:()=>{throw Error('backup failed');}}),/backup failed/);
 assert.deepEqual(fs.readFileSync(file),original);
 bag.setExpansion(file,'BAL',true,deps);
 const db=new DatabaseSync(file);db.exec("UPDATE master_bodylvl_status_value SET bag=999 WHERE type='BAL' AND grade=6 AND lvl=43");db.close();
 const conflicting=fs.readFileSync(file);
 assert.throws(()=>bag.setExpansion(file,'BAL',false,deps),/기록/);
 assert.deepEqual(fs.readFileSync(file),conflicting);
});

test('fighter menu refreshes displayed capacity after bag action and does not save fighter',async t=>{
 const {file,deps}=fixture(t), lines=[],answers=['5','0'];
 const before=structuredClone(fighter);
 const result=await require('../fighter-menu').chooseFighterUpdate({fighter,databasePath:file,
  rl:{question:async()=>{assert.ok(answers.length);return answers.shift();}},confirm:async()=>{throw Error('unexpected fighter write');},
  print:line=>lines.push(line),manageBag:async()=>bag.setExpansion(file,'BAL',true,deps)});
 assert.equal(result,null);assert.deepEqual(fighter,before);
 assert.ok(lines.some(line=>line.includes('가방 36칸')));assert.ok(lines.some(line=>line.includes('가방 86칸')));
});
