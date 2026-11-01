// SOURCE-only package-scoped service adapter contract.
// No TEST/Google HTTP, hosted worker activation, original-photo recovery or live SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLedger} from '../../supabase/functions/client-delivery/service-ledger.mjs';

const ids={
 package:'11111111-1111-4111-8111-111111111111',
 destination:'22222222-2222-4222-8222-222222222222',
 worker:'33333333-3333-4333-8333-333333333333',
 request:'44444444-4444-4444-8444-444444444444',
 root:'test_verified_drive_root_12345'
};
const makeLedger=fetcher=>createServiceLedger({
 url:'https://fwh-test.supabase.co',
 serviceRoleJwt:'header.payload.signature',fetcher
});

test('package claim and release use only exact future service RPCs, never legacy singleton',async()=>{
 const calls=[];
 const ledger=makeLedger(async(url,init)=>{
  const path=new URL(url).pathname;
  calls.push({path,method:init.method,body:JSON.parse(init.body)});
  if(path==='/rest/v1/rpc/service_claim_package_and_acquire_dispatch')
   return Response.json({claimed:false,acquired:false});
  if(path==='/rest/v1/rpc/service_release_package_dispatch')
   return Response.json({released:true});
  throw Error('UNEXPECTED_RPC');
 });
 assert.deepEqual(await ledger.claimPackageAndAcquireDispatch(
  ids.package,ids.destination,ids.root,ids.worker,ids.request
 ),{claimed:false,acquired:false});
 assert.deepEqual(await ledger.releasePackageDispatch(
  ids.package,ids.worker,ids.request,3
 ),{released:true});
 assert.deepEqual(calls,[
  {path:'/rest/v1/rpc/service_claim_package_and_acquire_dispatch',method:'POST',
   body:{p_package:ids.package,p_destination:ids.destination,p_root:ids.root,
    p_worker:ids.worker,p_request:ids.request}},
  {path:'/rest/v1/rpc/service_release_package_dispatch',method:'POST',
   body:{p_package:ids.package,p_worker:ids.worker,
    p_request:ids.request,p_generation:3}}
 ]);
});

test('bad package, worker, destination, root, request or lease generation is rejected before network',()=>{
 let calls=0;
 const ledger=makeLedger(async()=>{calls++;throw Error('SHOULD_NOT_CALL_NETWORK')});
 const base=[ids.package,ids.destination,ids.root,ids.worker,ids.request];
 for(const [field,value] of [[0,'wrong'],[1,''],[2,'bad/root'],[3,'wrong'],
   [4,'wrong']]){
  const args=[...base];args[field]=value;
  assert.throws(()=>ledger.claimPackageAndAcquireDispatch(...args),
   e=>e.code==='PACKAGE_DISPATCH_SCOPE_INVALID');
 }
 for(const args of [
  [ids.package,'bad',ids.request,3],
  [ids.package,ids.worker,'bad',3],
  [ids.package,ids.worker,ids.request,0],
  [ids.package,ids.worker,ids.request,-1],
  [ids.package,ids.worker,ids.request,1.1]
 ])assert.throws(()=>ledger.releasePackageDispatch(...args),
   e=>e.code==='PACKAGE_DISPATCH_SCOPE_INVALID');
 assert.equal(calls,0);
});

test('missing package RPC fails closed without any fallback to broad claim or global release',async()=>{
 const calls=[];
 const ledger=makeLedger(async(url)=>{
  const path=new URL(url).pathname;
  calls.push(path);
  return Response.json({message:'RPC not installed'},{status:404});
 });
 await assert.rejects(
  ledger.claimPackageAndAcquireDispatch(
   ids.package,ids.destination,ids.root,ids.worker,ids.request),
  e=>e.code==='SERVICE_RPC_UNAVAILABLE');
 assert.deepEqual(calls,['/rest/v1/rpc/service_claim_package_and_acquire_dispatch']);
});


test('exact package owner RPC is read-only and validates every input before network',async()=>{
 const calls=[];
 const ledger=makeLedger(async(url,init)=>{
  calls.push([new URL(url).pathname,JSON.parse(init.body)]);
  return Response.json({active:false});
 });
 assert.deepEqual(await ledger.readPackageDispatchOwner(
  ids.package,ids.worker,ids.request,1),{active:false});
 assert.deepEqual(calls,[['/rest/v1/rpc/service_read_package_dispatch_owner',
  {p_package:ids.package,p_worker:ids.worker,p_request:ids.request,p_generation:1}]]);
 for(const args of [
  ['wrong',ids.worker,ids.request,1],[ids.package,'bad',ids.request,1],
  [ids.package,ids.worker,'bad',1],[ids.package,ids.worker,ids.request,0]
 ])assert.throws(()=>ledger.readPackageDispatchOwner(...args),
  e=>e.code==='PACKAGE_DISPATCH_SCOPE_INVALID');
 assert.equal(calls.length,1);
});

test('package worker preflight denies stale worker and mismatched frozen destination',async()=>{
 const {verifyPackageScopedDeliveryOwner}=await import(
  '../../supabase/functions/client-delivery/worker-runtime.mjs');
 const scope={packageId:ids.package,workerId:ids.worker,requestId:ids.request,
  generation:1,destinationId:ids.destination,rootId:ids.root};
 const valid={active:true,package_id:ids.package,worker_id:ids.worker,
  request_id:ids.request,generation:1,destination_id:ids.destination,
  approved_sha256:'a'.repeat(64),manifest:{
   package_id:ids.package,destination_id:ids.destination,destination_root:ids.root}};
 const ledger=reply=>({readPackageDispatchOwner:async()=>reply});
 assert.equal((await verifyPackageScopedDeliveryOwner({
  ...scope,ledger:ledger(valid)})).approvedSha256,'a'.repeat(64));
 for(const reply of [
  {active:false},{...valid,generation:2},
  {...valid,worker_id:ids.destination},
  {...valid,manifest:{...valid.manifest,destination_root:'wrong_folder_root_123456'}},
  {...valid,approved_sha256:''}
 ])await assert.rejects(verifyPackageScopedDeliveryOwner({
  ...scope,ledger:ledger(reply)}),
  e=>e.code==='PACKAGE_DISPATCH_OWNER_UNVERIFIED');
});
