import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLedger} from '../../supabase/functions/client-delivery/service-ledger.mjs';
const pkg='00000000-0000-4000-8000-000000000001';
const worker='00000000-0000-4000-8000-000000000002';
const token='abcde.abcde.abcde';
function make(){
 const calls=[];
 const ledger=createServiceLedger({
  url:'https://disposable.supabase.co',serviceRoleJwt:token,
  fetcher:async(input,opts)=>{
   const url=new URL(input);
   calls.push({name:url.pathname.split('/').at(-1),body:JSON.parse(opts.body)});
   return new Response(JSON.stringify({exists:false}),{
    status:200,headers:{'Content-Type':'application/json'}});
  }
 });
 return {ledger,calls};
}
for(const kind of ['STATE','COUNTY','CITY']){
 test(kind+' uses only scoped geographic lookup/reserve RPCs',async()=>{
  const {ledger,calls}=make();
  await ledger.readParent(pkg,worker,1,kind);
  await ledger.reserveParent(pkg,worker,1,kind,'geo_'+'a'.repeat(24),'root_'+'b'.repeat(24));
  assert.deepEqual(calls.map(x=>x.name),
   ['service_read_geographic_parent','service_reserve_geographic_parent']);
  for(const call of calls){
   assert.equal(call.body.p_kind,kind);
   assert.equal(call.body.p_package,pkg);
   assert.equal(call.body.p_worker,worker);
   assert.equal(call.body.p_generation,1);
  }
 });
}
test('legacy ADDRESS and WORK_ORDER keep original guarded reservation methods',async()=>{
 const {ledger,calls}=make();
 for(const kind of ['ADDRESS','WORK_ORDER']){
  await ledger.readParent(pkg,worker,1,kind);
  await ledger.reserveParent(pkg,worker,1,kind,'node_'+'a'.repeat(24),'root_'+'b'.repeat(24));
 }
 assert.deepEqual(calls.map(x=>x.name),[
  'service_read_delivery_parent','service_reserve_delivery_parent',
  'service_read_delivery_parent','service_reserve_delivery_parent']);
});

test('geographic ADDRESS/WO leaves do not call the legacy root-folder RPC',async()=>{
 const {ledger,calls}=make();
 for(const kind of ['ADDRESS','WORK_ORDER']){
  await ledger.readGeographicLeaf(pkg,worker,1,kind);
  await ledger.reserveGeographicLeaf(pkg,worker,1,kind,'node_'+'a'.repeat(24),'city_'+'b'.repeat(24));
 }
 assert.deepEqual(calls.map(c=>c.name),[
  'service_read_geographic_leaf','service_reserve_geographic_leaf',
  'service_read_geographic_leaf','service_reserve_geographic_leaf']);
 for(const c of calls){
  assert.equal(c.body.p_package,pkg);
  assert.equal(c.body.p_worker,worker);
  assert.equal(c.body.p_generation,1);
 }
});
