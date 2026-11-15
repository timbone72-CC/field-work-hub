const test=require('node:test');
const assert=require('node:assert/strict');
const {JobQueueRules:queues,JobOperationalFacts:facts}=require('../../dashboard/job-workspace.js');
const org='00000000-0000-4000-8000-000000000001';
function snapshot(queue='ALL'){
 const counts=Object.fromEntries(Object.keys(queues.labels).map(key=>[key,0]));
 counts.ALL=counts[queue]=1;
 return {organization_id:org,rows:[{id:'exact-job',organization_id:org,
  operational:{primary:'COMPLETED',queues:{ALL:true,[queue]:true}}}],
  total:1,offset:0,size:25,queue,as_of:'2026-11-15T15:00:00Z',scope_fingerprint:'a'.repeat(32),counts};
}
test('queue request keeps a bounded typed whitelist and excludes identities/auth payloads',()=>{
 const q=queues.filters({size:5000,offset:-2,queue:'eq.COMPLETED,ALL',sort:'secret.asc',
  company:'eq.foreign',contractor:'x',search:'A%_*',access_token:'secret',organization_id:org});
 assert.deepEqual(q,{size:25,offset:0,sort:'created_at.desc',status:'',queue:'ALL',
  search:'A%_*',searchField:'property_address',companySearch:'eq.foreign',contractor:'',dueDate:''});
});
test('queue response cannot mix a different org/filter/count or oversized page',()=>{
 const page={size:25,offset:0,queue:'COMPLETED'};
 assert.doesNotThrow(()=>queues.validate(snapshot('COMPLETED'),page,org));
 for(const mutate of [s=>s.organization_id='foreign',s=>s.rows[0].organization_id='foreign',
  s=>s.queue='ALL',s=>s.total=2,s=>s.rows[0].operational.queues.COMPLETED=false,
  s=>s.counts.COMPLETED=-1,s=>s.as_of='bad',s=>s.offset=25,
  s=>s.rows=Array(26).fill(s.rows[0]),s=>s.scope_fingerprint='']){
  const s=snapshot('COMPLETED');mutate(s);
  assert.throws(()=>queues.validate(s,page,org),/Unexpected authorized/);
 }
});
test('verified server queue facts supply distinct actions without changing field state',()=>{
 const base={field_status:'FIELD_COMPLETE'};
 for(const [primary,label,panel] of [['COMPLETED','Completed','history'],
  ['READY_TO_SEND','Ready to send','delivery'],['DELIVERY_PROBLEM','Delivery problem','delivery'],
  ['PHOTOS_PENDING','Finished — photos pending','photos']]){
  const row={...base,operational:{primary}};
  assert.equal(facts.project(row).label,label);assert.equal(facts.project(row).panel,panel);
  assert.equal(row.field_status,'FIELD_COMPLETE');
 }
 assert.equal(facts.project({...base,operational:{primary:'AWAITING_REVIEW',review_required:false}}).next,'Prepare package');
 assert.match(facts.project(base).label,/status not loaded/);
});
