'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const PhotoRules=require('../../dashboard/photo-requirements.js');
const source=fs.readFileSync(require.resolve('../../dashboard/correction-draft.js'),'utf8');
const start=source.indexOf('  async function save(){'),end=source.indexOf('  async function showPreview(){',start);
assert.ok(start>0&&end>start);
const comparison=source.match(/  function sameJson\(a,b\)\{[\s\S]*?\n  }/)?.[0]||'';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const issue=n=>({photo_id:null,item_id:id(n),reason:'Replacement '+n,requested_count:1});
const wire=v=>v.map(i=>({reason:i.reason,item_id:i.item_id,photo_id:i.photo_id,requested_count:i.requested_count}));
function rig({saved=v=>v,read=v=>v,revision=id(8),status='DRAFT',two=false}={}){
 const issues=two?[issue(3),issue(4)]:[issue(3)],calls=[],messages=[],fills=[];
 const cfg={schema:1,revision:id(2),total:{enabled:false,minimum:0},items:[]};
 const context={data:{},busy:false,uncertain:false,generation:1,wo:id(1),accessToken:'fixture-token',
  issues,preview:{stale:true},UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  structuredClone,PhotoRules,JobWorkspace:{detailsDirty:()=>false,needsReload:()=>false},ClientRelease:{dirty:()=>false},
  inputData:()=>({p_reason:'TEST reason',p_assigned_user:id(5),p_due_date:'2026-11-16',p_capture_requirements:cfg,p_release_requirements:cfg}),
  valid:()=>true,buttons(){},status:(text,bad)=>messages.push({text,bad}),fill:d=>fills.push(d),
  rpc:async(name,body)=>{calls.push({name,body});return name==='admin_save_correction_draft_with_issues'
   ?{revision,status,issues:saved(wire(structuredClone(issues)))}
   :{draft:{revision,issues:read(wire(structuredClone(issues)))}};}};
 vm.createContext(context);vm.runInContext(comparison+'\n'+source.slice(start,end)+'\nthis.runSave=save;',context);
 return {context,calls,messages,fills,run:()=>context.runSave()};
}
test('atomic correction save confirms JSONB field reordering in both write response and readback',async()=>{
 const x=rig();assert.equal(await x.run(),true);
 assert.deepEqual(x.calls.map(c=>c.name),['admin_save_correction_draft_with_issues','admin_correction_state']);
 assert.equal(x.fills.length,1);assert.match(x.messages.at(-1).text,/Draft saved/);
 assert.equal(x.context.issues[0].requested_count,1);
});
test('a materially different saved issue is still unconfirmed and retains client input',async()=>{
 for(const mutate of [v=>{v[0].requested_count=2;return v;},v=>{v[0].requested_count='1';return v;},
  v=>{v[0].unexpected=true;return v;},v=>{delete v[0].photo_id;return v;}]){
  const x=rig({saved:mutate});assert.equal(await x.run(),false);assert.equal(x.calls.length,1);
  assert.equal(x.fills.length,0);assert.equal(x.context.preview,null);
  assert.equal(x.context.issues[0].requested_count,1);assert.match(x.messages.at(-1).text,/Atomic correction/);
 }
});
test('readback changes still block confirmation after an equal save response',async()=>{
 const x=rig({read:v=>{v[0].reason='Changed elsewhere';return v;}});
 assert.equal(await x.run(),false);assert.equal(x.calls.length,2);assert.equal(x.fills.length,0);
 assert.match(x.messages.at(-1).text,/changed during verification/);
});
test('issue array ordering remains significant',async()=>{
 const x=rig({two:true,saved:v=>v.reverse()});assert.equal(await x.run(),false);
 assert.equal(x.fills.length,0);assert.equal(x.context.issues[0].item_id,id(3));
});
test('revision and draft status checks remain required',async()=>{
 for(const flags of [{revision:'invalid'},{status:'DISPATCHED'}]){
  const x=rig(flags);assert.equal(await x.run(),false);assert.equal(x.calls.length,1);assert.equal(x.fills.length,0);
 }
});
