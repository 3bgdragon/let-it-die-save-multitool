'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const model=require('../fighter-model');
const keys=['hp','str','dex','vit','stm','luk'];
const six=v=>Object.fromEntries(keys.map(k=>[k,v]));
const fighter={type:'BAL',grade:6,limitBreak:3,stats:{...six(40),skill:4,bag:50,rage:0,...Object.fromEntries(keys.map(k=>[k+'_bonus',5]))}};
function fixture(t,{max=50,exp=500,slots=15}={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lid-fighter-model-'));
 t.after(()=>{assert.ok(path.basename(dir).startsWith('lid-fighter-model-')); assert.equal(path.dirname(dir),path.resolve(os.tmpdir())); fs.rmSync(dir,{recursive:true,force:true});});
 const file=path.join(dir,'masters.db'), db=new DatabaseSync(file);
 db.exec('CREATE TABLE master_body_detail(type TEXT,grade INTEGER,limit_break INTEGER,param_lv_max INTEGER,skill_slots TEXT,bag_capacity INTEGER,rage_capacity INTEGER); CREATE TABLE master_bodylvl_status_value(type TEXT,grade INTEGER,limit_break INTEGER,lvl INTEGER,hp INTEGER,str INTEGER,dex INTEGER,vit INTEGER,stm INTEGER,luk INTEGER,skill INTEGER,bag INTEGER,rage INTEGER); CREATE TABLE master_bodylvl_exp(grade INTEGER,lvl INTEGER);');
 for(let lb=0;lb<=4;lb++) db.prepare('INSERT INTO master_body_detail VALUES (?,?,?,?,?,?,?)').run('BAL',6,lb,lb===4?max:25+lb*5,Array.from({length:lb===4?slots:5+lb},(_,i)=>i+1).join(','),24+3*lb,5);
 for(let level=1;level<=max;level++){
  const lb=level<=25?0:Math.min(4,Math.floor((level-26)/5)+1);
  const skill=level<=25?5:([26,31,36,41].includes(level)?5+lb:0);
  const bag=level<=25?24:(level<=43 && (level-26)%5<3?24+(lb-1)*3+1+(level-26)%5:0);
  db.prepare('INSERT INTO master_bodylvl_status_value VALUES (?,?,?,?,100,10,10,10,10,10,?,?,?)').run('BAL',6,lb,level,skill,bag,skill?5:0);
 }
 for(let i=1;i<=exp;i++) db.prepare('INSERT INTO master_bodylvl_exp VALUES(6,?)').run(i);
 db.close(); return file;
}
test('Darleen regression: bag 50 maps to absent row 88; DB max retains 50, nine slots',t=>{
 const file=fixture(t), before=fs.readFileSync(file);
 const limits=model.readFighterLimits(file,fighter), current=model.inspectFighter(limits,fighter.stats);
 assert.equal(current.converted.bag,88); assert.equal(current.limitBreak,undefined);
 assert.throws(()=>model.validateFighterStatUpdates(file,fighter,{hp:50}),/bag.*88/);
 const update=model.buildFighterMaximum(file,fighter);
 assert.deepEqual({...six(50),skill:4,bag:12,rage:0},Object.fromEntries(Object.entries(update).filter(([k])=>!k.endsWith('_bonus'))));
 const state=model.validateFighterStatUpdates(file,fighter,update);
 assert.equal(state.limitBreak,4); assert.equal(state.slots,9); assert.equal(state.bag,36);
 assert.deepEqual(fs.readFileSync(file),before);
});
test('stock DB reaches 45 despite cached limit break 3; expanded DB reaches 50',t=>{
 const file=fixture(t,{max:45,exp:280,slots:9});
 assert.equal(model.buildFighterMaximum(file,fighter).hp,45);
 assert.equal(model.buildFighterMaximum(fixture(t),fighter,true).hp,45);
});
test('missing, zero and NULL rows are never selected as maxima',t=>{
 const file=fixture(t),db=new DatabaseSync(file);
 db.exec('DELETE FROM master_bodylvl_status_value WHERE lvl=49; UPDATE master_bodylvl_status_value SET hp=0,str=NULL WHERE lvl=50'); db.close();
 const u=model.buildFighterMaximum(file,fighter);
 assert.equal(u.hp,48);assert.equal(u.str,48);assert.equal(u.dex,50);
 assert.throws(()=>model.validateFighterStatUpdates(file,fighter,{...u,hp:49}),/HP/);
});
test('bonus-only and extra-only edits run full validation; maximum repairs old bonus 50',t=>{
 const file=fixture(t), good={...fighter,stats:model.buildFighterMaximum(file,fighter)};
 for(const edit of [{hp_bonus:50},{hp_bonus:4},{bag:50},{skill:10},{rage:-1},{hp:0}])
  assert.throws(()=>model.validateFighterStatUpdates(file,good,edit));
 const bad={...fighter,stats:{...fighter.stats,hp_bonus:50}};
 assert.equal(model.buildFighterMaximum(file,bad).hp_bonus,5);
});
test('missing experience blocks complete preset before mutation',t=>{
 const file=fixture(t,{exp:280});
 assert.throws(()=>model.buildFighterMaximum(file,fighter),/총 레벨 311/);
});
test('grade and class are looked up independently; no global fallback',t=>{
 const file=fixture(t);
 for(const change of [{type:'BRE'},{grade:5}]) assert.throws(()=>model.buildFighterMaximum(file,{...fighter,...change}),/상한 정보/);
});
test('in-memory preset changes only selected fighter body; other save data is preserved',t=>{
 const {getFighterList,replaceFighterStats}=require('../lid-kc'),file=fixture(t);
 const data={soul:{uid:1,chr:{chrs:[{cid:'a',name:'Darleen',type:'BAL',grade:6,limit_break:3}]}},bodyuser:{'1':[{cid:'a',...fighter.stats},{cid:'other',hp:12}]},untouched:{coins:123}};
 const save={data,jsonText:JSON.stringify(data)},target=getFighterList(save)[0],u=model.buildFighterMaximum(file,target);
 const result=JSON.parse(replaceFighterStats(save,0,u).changedText);
 assert.equal(result.bodyuser['1'][0].lvl,311);assert.equal(result.bodyuser['1'][0].hp,50);
 assert.equal(result.bodyuser['1'][0].skill,4);assert.equal(result.bodyuser['1'][0].bag,12);
 assert.deepEqual(result.soul,data.soul);assert.deepEqual(result.untouched,data.untouched);
 assert.deepEqual(result.bodyuser['1'][1],data.bodyuser['1'][1]);
 assert.equal(save.data.bodyuser['1'][0].bag,50);
});
test('writer routes bonus-only and bag-only edits through validation before any mutation',t=>{
 const vm=require('node:vm'), file=fixture(t), sentinel=Buffer.from('original-save');
 const source=fs.readFileSync(path.join(__dirname,'../lid-kc.js'),'utf8');
 const code=source.slice(source.indexOf('function writeFighterStats('),source.indexOf('function packSave('));
 let mutations=0;
 const context=vm.createContext({fs:{readFileSync:()=>sentinel},isGameRunning:()=>false,
  getFighterList:()=>[fighter],getMasterDatabasePath:()=>file,require:()=>model,
  replaceFighterStats:()=>{mutations++;throw Error('unexpected mutation');},fail:message=>{throw Error(message);}});
 vm.runInContext(code,context);
 for(const update of [{hp_bonus:50},{bag:50}]) assert.throws(()=>context.writeFighterStats('unused.sav',{packed:sentinel},0,update),/보너스|bag/);
 assert.equal(mutations,0);
});

function menuSession(databasePath, target, answers, confirmations) {
 const {chooseFighterUpdate}=require('../fighter-menu');
 const lines=[], questions=[];
 let confirmationCount=0;
 const result=chooseFighterUpdate({databasePath,fighter:target,print:line=>lines.push(line),
  rl:{question:async prompt=>{questions.push(prompt);if(!answers.length)throw Error('input exhausted');return answers.shift();}},
  confirm:async()=>{confirmationCount++;return confirmations.shift();}});
 return {result,lines,questions,count:()=>confirmationCount};
}

test('overview shows every current bonus and editing path without changing fighter', t => {
 const {overviewLines}=require('../fighter-menu');
 const file=fixture(t), target=structuredClone(fighter);
 [0,1,2,3,5,50].forEach((value,i)=>{target.stats[keys[i]+'_bonus']=value;});
 const before=structuredClone(target), limits=model.readFighterLimits(file,target);
 const lines=overviewLines(target,limits);
 assert.ok(lines.includes('생성 보너스: HP +0 / STR +1 / DEX +2 / VIT +3 / STM +5 / LUK +50'));
 assert.ok(lines.some(line=>line.includes('3. 직접 설정 → 5. 생성 보너스') && line.includes('+0, +1, +2, +3, +5')));
 assert.deepEqual(target,before);
 delete target.stats.hp_bonus;
 assert.ok(overviewLines(target,limits).some(line=>line.startsWith('생성 보너스: HP +0')));
});
test('simple menu maximum previews actual capacities and confirms once',async t=>{
 const file=fixture(t),before=structuredClone(fighter);
 const session=menuSession(file,fighter,['1'],[true]);
 const result=await session.result;
 assert.equal(result.updates.hp,50);assert.equal(result.updates.skill,4);assert.equal(result.updates.bag,12);
 assert.equal(session.count(),1);
 assert.ok(session.lines.includes('데칼: 9칸 → 9칸'));
 assert.ok(session.lines.includes('가방: 확인 불가칸 → 36칸'));
 assert.deepEqual(fighter,before);
});
test('custom menu converts final nine decal slots to save upgrade count four',async t=>{
 const file=fixture(t),target={...fighter,stats:{...model.buildFighterMaximum(file,fighter),skill:1}};
 const session=menuSession(file,target,['3','3','9'],[true]);
 assert.deepEqual((await session.result).updates,{skill:4});
 assert.ok(session.lines.includes('데칼: 6칸 → 9칸'));
});
test('custom bag uses final capacity and cancel returns without an update',async t=>{
 const file=fixture(t),target={...fighter,stats:model.buildFighterMaximum(file,fighter)};
 const bag=menuSession(file,target,['3','4','36'],[true]);
 assert.deepEqual((await bag.result).updates,{bag:12});
 const cancelled=menuSession(file,target,['1','0'],[false]);
 assert.equal(await cancelled.result,null);assert.equal(cancelled.count(),1);
});
