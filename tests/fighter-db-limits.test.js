'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { readFighterLimits, validateFighterStatUpdates } = require('../fighter-db-limits');
const keys = ['hp','str','dex','vit','stm','luk'];
const stats = (level) => Object.fromEntries(keys.map((key) => [key, level]));
const fighter = { type:'BAL', grade:6, limitBreak:4, stats:stats(45) };

function fixture(t, { cap=45, max=45, exp=280 }={}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'lid-stat-db-'));
  t.after(() => {
    assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('lid-stat-db-'));
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const file = path.join(dir,'masters.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE master_body_detail(type TEXT,grade INTEGER,limit_break INTEGER,param_lv_max INTEGER);
    CREATE TABLE master_bodylvl_status_value(type TEXT,grade INTEGER,limit_break INTEGER,lvl INTEGER,hp REAL,str REAL,dex REAL,vit REAL,stm REAL,luk REAL);
    CREATE TABLE master_bodylvl_exp(grade INTEGER,lvl INTEGER);`);
  db.prepare('INSERT INTO master_body_detail VALUES (?,6,0,?)').run('BAL',25);
  db.prepare('INSERT INTO master_body_detail VALUES (?,6,4,?)').run('BAL',cap);
  const insert=db.prepare("INSERT INTO master_bodylvl_status_value VALUES ('BAL',6,4,?,100,10,10,10,10,10)");
  for(let i=1;i<=max;i++) insert.run(i);
  const experience=db.prepare('INSERT INTO master_bodylvl_exp VALUES (6,?)');
  for(let i=1;i<=exp;i++) experience.run(i);
  db.close();
  return file;
}
function change(file,sql) { const db=new DatabaseSync(file); try { db.exec(sql); } finally { db.close(); } }

test('updated stock DB returns 45, rejects 50, never changes DB',t=>{
  const file=fixture(t),before=fs.readFileSync(file);
  assert.deepEqual(readFighterLimits(file,fighter).maxima,stats(45));
  assert.throws(()=>validateFighterStatUpdates(file,fighter,stats(50)),/유효한 데이터/);
  assert.doesNotThrow(()=>validateFighterStatUpdates(file,fighter,stats(45)));
  assert.deepEqual(fs.readFileSync(file),before);
});
test('complete expansion allows 50 and recovery from invalid saved levels',t=>{
  const file=fixture(t,{cap:50,max:50,exp:500});
  const updates=readFighterLimits(file,fighter).maxima;
  assert.deepEqual(updates,stats(50));
  assert.doesNotThrow(()=>validateFighterStatUpdates(file,{...fighter,stats:stats(0)},updates));
});
test('declared cap does not substitute for missing rows; holes are rejected',t=>{
  const file=fixture(t,{cap:50});
  assert.deepEqual(readFighterLimits(file,fighter).maxima,stats(45));
  change(file,'DELETE FROM master_bodylvl_status_value WHERE lvl=40');
  assert.throws(()=>validateFighterStatUpdates(file,fighter,{hp:40}),/HP/);
});
test('zero and NULL placeholders are excluded per stat',t=>{
  const file=fixture(t,{cap:50,max:50,exp:500});
  change(file,'UPDATE master_bodylvl_status_value SET hp=0,str=NULL WHERE lvl=50');
  const limits=readFighterLimits(file,fighter);
  assert.equal(limits.maxima.hp,49);assert.equal(limits.maxima.str,49);assert.equal(limits.maxima.dex,50);
  assert.throws(()=>validateFighterStatUpdates(file,fighter,stats(50)),/HP/);
});
test('grade, class and limit break are respected',t=>{
  const file=fixture(t);
  for(const changes of [{type:'BRE'},{grade:5},{limitBreak:0}])
    assert.throws(()=>readFighterLimits(file,{...fighter,...changes}),/상한 정보|유효한 DB/);
  change(file,"INSERT INTO master_body_detail VALUES ('BAL',6,0,25)");
    assert.throws(()=>readFighterLimits(file,{...fighter,limitBreak:0}),/유효한 DB|상한 정보/);
});
test('missing total-level experience prevents saving',t=>{
  const file=fixture(t,{cap:50,max:50});
  assert.throws(()=>validateFighterStatUpdates(file,fighter,stats(50)),/총 레벨 295/);
});
test('bonus edits are constrained to the stock grade range',t=>{
  const file=fixture(t);
  assert.doesNotThrow(()=>validateFighterStatUpdates(file,{...fighter,stats:{...stats(45),hp_bonus:5}}, {hp_bonus:5}));
  assert.throws(()=>validateFighterStatUpdates(file,{...fighter,stats:{...stats(45),hp_bonus:50}}, {hp_bonus:50}),/순정 보너스 범위/);
});
test('valid DB maximum repairs selected in-memory fighter and preserves other data',t=>{
  const file=fixture(t);
  const {getFighterList,replaceFighterStats}=require('../lid-kc');
  const data={soul:{uid:1,chr:{chrs:[{cid:'a',name:'Test',type:'BAL',grade:6,limit_break:4}]}},
    bodyuser:{'1':[{cid:'a',...stats(50),lvl:295,skill:0,bag:0,rage:0},{cid:'other',hp:12}]},untouched:{coins:123}};
  const save={data,jsonText:JSON.stringify(data)};
  const target=getFighterList(save)[0];
  const updates=readFighterLimits(file,target).maxima;
  validateFighterStatUpdates(file,target,updates);
  const result=JSON.parse(replaceFighterStats(save,0,updates).changedText);
  assert.equal(result.bodyuser['1'][0].hp,45);
  assert.equal(result.bodyuser['1'][0].lvl,265);
  assert.deepEqual(result.bodyuser['1'][1],data.bodyuser['1'][1]);
  assert.deepEqual(result.untouched,data.untouched);
  assert.deepEqual(result.soul,data.soul);
  assert.equal(data.bodyuser['1'][0].hp,50);
});
test('writer rejects invalid stat before packing, backups or writes',t=>{
  const file=fixture(t),sentinel=Buffer.from('original-save');
  const source=fs.readFileSync(path.resolve(__dirname,'../lid-kc.js'),'utf8');
  const code=source.slice(source.indexOf('function writeFighterStats('),source.indexOf('function packSave('));
  let mutated=false;
  const context=vm.createContext({
    fs:{readFileSync:()=>sentinel},isGameRunning:()=>false,
    getFighterList:()=>[fighter],FIGHTER_STAT_KEYS:keys,getMasterDatabasePath:()=>file,
    require:()=>({validateFighterStatUpdates}),
    replaceFighterStats:()=>{mutated=true;throw Error('should not mutate');},
    fail:message=>{throw Error(message);}
  });
  vm.runInContext(code,context);
  assert.throws(()=>context.writeFighterStats('fake.sav',{packed:sentinel},0,stats(50)),/유효한 데이터/);
  assert.equal(mutated,false);
});
