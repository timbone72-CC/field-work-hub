const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const copies = require('../../dashboard/repeat-run-copies.js');
const rules = require('../../dashboard/photo-requirements.js');
const uuid = n => '00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const wo=uuid(1),current=uuid(2),prior=uuid(3);

test('Phase 6B prior-visit picker keeps bounded same-WO history and excludes current visit',()=>{
  const result=copies.history([
    {id:current,work_order_id:wo,run_sequence:2},
    {id:prior,work_order_id:wo,run_sequence:1}
  ],wo,current);
  assert.deepEqual(result,{earlier:[{id:prior,work_order_id:wo,run_sequence:1}],more:false});
  const many=Array.from({length:26},(_,i)=>({
    id:uuid(i+100),work_order_id:wo,run_sequence:26-i
  }));
  assert.equal(copies.history(many,wo,current).earlier.length,25);
  assert.equal(copies.history(many,wo,current).more,true);
  assert.throws(()=>copies.history(many.concat(many[0]),wo,current),/bounded/);
});

test('Phase 6B historical choice rejects foreign WO, duplicate IDs, invalid sequence, absent run and mixed rows',()=>{
  const row={id:prior,work_order_id:wo,run_sequence:1};
  assert.throws(()=>copies.history([row,{...row}],wo,current),/history/);
  assert.throws(()=>copies.history([{...row,work_order_id:uuid(19)}],wo,current),/work order/);
  assert.throws(()=>copies.history([{...row,run_sequence:0}],wo,current),/work order/);
  assert.throws(()=>copies.history([{...row,id:'wrong'}],wo,current),/work order/);
  for(const bad of [[],[{id:prior,work_order_id:uuid(12),requirement_snapshot:{}}],
    [{id:current,work_order_id:wo,requirement_snapshot:{}}],
    [{id:prior,work_order_id:wo}],
    [{id:prior,work_order_id:wo,requirement_snapshot:{}},
      {id:current,work_order_id:wo,requirement_snapshot:{}}]])
    assert.throws(()=>copies.sourceSnapshot(bad,wo,prior),/historical visit/);
});

test('Phase 6B historical frozen requirements are copied with a fresh revision, even without a saved template',()=>{
  const old=rules.empty();
  old.items.push({id:uuid(40),label:'Front',enabled:true,minimum:2,
    instruction:'Prior visit',stage:'BEFORE',framing:'WIDE',order:0});
  const original=structuredClone(old);
  const snapshot=copies.sourceSnapshot([{id:prior,work_order_id:wo,requirement_snapshot:old}],wo,prior);
  const next=rules.copyPriorSnapshot(snapshot);
  assert.deepEqual(old,original);
  assert.notEqual(next.revision,old.revision);
  assert.deepEqual(next.items,old.items);
  assert.equal(rules.copyPriorSnapshot(copies.sourceSnapshot([
    {id:prior,work_order_id:wo,requirement_snapshot:null}
  ],wo,prior)).items.length,0);
});

test('Phase 6B existing repeat-work controls use authenticated scoped history, never mutate a historical run',()=>{
  const app=fs.readFileSync(require.resolve('../../dashboard/app.js'),'utf8');
  const workspace=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
  const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
  for(const id of ['repeat-source-run','repeat-load-runs','repeat-source-status'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/repeat-run-copies\.js\?v=/);
  assert.match(app,/work_order_runs\?select=/);
  assert.match(app,/work_order_id=eq\./);
  assert.match(app,/run_sequence\.desc&limit=26/);
  assert.match(app,/RepeatRunCopies\.history\(/);
  assert.match(app,/RepeatRunCopies\.sourceSnapshot\(/);
  assert.match(app,/PhotoRules\.copyPriorSnapshot\(/);
  assert.match(app,/accessToken!==token/);
  assert.match(workspace,/resetRepeatRunChoices\(row\.id\)/);
  assert.match(workspace,/resetRepeatRunChoices\(\)/);
  assert.doesNotMatch(app,/UPDATE work_order_runs|PATCH work_order_runs/);
});
