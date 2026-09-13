'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const script=path.resolve(__dirname,'../lid-kc.js');
function api() {
  const context=vm.createContext({require:createRequire(script),module:{exports:{}},__dirname:path.dirname(script),Buffer,console,process});
  vm.runInContext(fs.readFileSync(script,'utf8')+'\nglobalThis.api={getBloodniumShopState,replaceBloodniumShopHistory,writeBloodniumShopReset,packSave,readSave};',context);
  return {context,...context.api};
}
function save(a,b) {
  const jsonText=`{ "untouched":9007199254740993123,"soul":{"free_money":123,"spirit":456,"bloodnium_point":789},"user":{"automaticshop_bloodnium_exchangeable_goods_ids":${JSON.stringify(a)},"automaticshop_bloodnium_exchanged_goods_ids":${JSON.stringify(b)},"other":"unchanged"},"x":1.000 }`;
  return {jsonText,data:JSON.parse(jsonText)};
}
test('duplicate purchase history can be inspected without modifying source',()=>{
  const {getBloodniumShopState}=api(),source=save('1,2','3,3,3'),before=JSON.stringify(source);
  const state=getBloodniumShopState(source);
  assert.deepEqual(Array.from(state.bought),['3']);assert.equal(state.duplicateCount,2);assert.equal(state.needsReset,true);
  assert.equal(JSON.stringify(source),before);
});
test('reset deduplicates within/across lists, preserves first occurrence order and all other JSON bytes',()=>{
  const {replaceBloodniumShopHistory,getBloodniumShopState}=api();
  for(const [a,b,want] of [['1,2','3,3','1,2,3'],['1,1,2','2,3,3','1,2,3'],['1,1','','1'],['','4,4','4'],['1,2','3','1,2,3']]) {
    const source=save(a,b),out=replaceBloodniumShopHistory(source);
    assert.equal(out.changedText,save(want,'').jsonText);
    const result={jsonText:out.changedText,data:JSON.parse(out.changedText)};
    assert.equal(getBloodniumShopState(result).needsReset,false);
  }
});
test('malformed ID lists still fail instead of silently dropping data',()=>{
  const {getBloodniumShopState,replaceBloodniumShopHistory}=api();
  for(const value of [null,123,[], '1,,2','1,x','-1','1, 2'])assert.throws(()=>getBloodniumShopState(save('',value)));
  const source=save('1','2,2');source.data.user.automaticshop_bloodnium_exchanged_goods_ids='2';
  assert.throws(()=>replaceBloodniumShopHistory(source),/교차 검증/);
});
test('packed save reset backs up exact input; duplicates-only reset and concurrent changes are handled',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lid-bloodnium-test-'));
  t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('lid-bloodnium-test-'));fs.rmSync(dir,{recursive:true,force:true});});
  const a=api();a.context.testBackup=path.join(dir,'before.bak');
  vm.runInContext('isGameRunning=()=>false; createBackup=(file,bytes)=>{fs.writeFileSync(testBackup,bytes);return testBackup;};',a.context);
  const file=path.join(dir,'test.sav'),source=save('1,1','2,2');
  const original=a.packSave(source.jsonText,2,Buffer.alloc(4));fs.writeFileSync(file,original);
  a.writeBloodniumShopReset(file,a.readSave(file));
  assert.deepEqual(fs.readFileSync(a.context.testBackup),original);
  const result=a.readSave(file);assert.equal(result.jsonText,save('1,2','').jsonText);assert.deepEqual(result.trailer,Buffer.alloc(4));
  assert.throws(()=>a.writeBloodniumShopReset(file,result),/재고/);
  fs.writeFileSync(file,a.packSave(save('1,1','').jsonText,1,Buffer.alloc(4)));
  a.writeBloodniumShopReset(file,a.readSave(file));assert.equal(a.readSave(file).jsonText,save('1','').jsonText);
  const stale=a.readSave(file);fs.appendFileSync(file,'changed');
  assert.throws(()=>a.writeBloodniumShopReset(file,stale),/변경/);
});
