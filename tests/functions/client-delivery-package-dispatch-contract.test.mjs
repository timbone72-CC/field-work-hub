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


test('pinned read validates standard five-group UUID before its service-only RPC',async()=>{
 const calls=[];
 const ledger=makeLedger(async(url,init)=>{
  calls.push([new URL(url).pathname,JSON.parse(init.body)]);
  return Response.json({present:false,active:false});
 });
 assert.deepEqual(await ledger.readPinnedPackageDispatch(
  ids.package,ids.destination,ids.root),{present:false,active:false});
 assert.deepEqual(calls,[['/rest/v1/rpc/service_read_pinned_package_dispatch',
  {p_package:ids.package,p_destination:ids.destination,p_root:ids.root}]]);
 for(const args of [
  ['11111111-1111-4111-111111111111',ids.destination,ids.root],
  ['bad',ids.destination,ids.root],
  [ids.package,'wrong',ids.root],[ids.package,ids.destination,'other/root']
 ])assert.throws(()=>ledger.readPinnedPackageDispatch(...args),
  e=>e.code==='PACKAGE_DISPATCH_SCOPE_INVALID');
 assert.equal(calls.length,1,'invalid IDs must not send privileged RPCs');
});

test('fresh provider-proof RPC preserves normal UUIDs and requires exact scope',async()=>{
 const calls=[],observed='2026-11-02T05:18:38.315Z';
 const proof={account:'fixture@example.invalid',drive_id:'test_shared_drive_12345',
  permission_id:'test_permission_123456'};
 const ledger=makeLedger(async(url,init)=>{
  calls.push([new URL(url).pathname,JSON.parse(init.body)]);
  return Response.json({verified:true,package_id:ids.package,request_id:ids.request});
 });
 assert.deepEqual(await ledger.recordPinnedPackageProviderCheck(
  ids.package,ids.destination,ids.root,proof,observed,ids.request),
  {verified:true,package_id:ids.package,request_id:ids.request});
 assert.deepEqual(calls,[['/rest/v1/rpc/service_record_pinned_package_provider_check',{
  p_package:ids.package,p_destination:ids.destination,p_root:ids.root,
  p_account:proof.account,p_drive:proof.drive_id,p_permission:proof.permission_id,
  p_observed_at:observed,p_request:ids.request
 }]]);
 for(const args of [
  ['bad',ids.destination,ids.root,proof,observed,ids.request],
  [ids.package,'bad',ids.root,proof,observed,ids.request],
  [ids.package,ids.destination,ids.root,proof,observed,'bad'],
  [ids.package,ids.destination,'bad/root',proof,observed,ids.request],
  [ids.package,ids.destination,ids.root,{...proof,permission_id:null},observed,ids.request]
 ])assert.throws(()=>ledger.recordPinnedPackageProviderCheck(...args),
  e=>e.code==='PACKAGE_PROVIDER_PROOF_INVALID');
 assert.equal(calls.length,1,'malformed provider evidence must not write a proof');
});

test('expired package lease renewal sends exactly the saved owner and fresh GET proof',async()=>{
 const calls=[],stamp='2026-11-02T13:21:39.271Z';
 const proof={account:'fixture@example.invalid',drive_id:'test_shared_drive_12345',
  permission_id:'test_permission_123456'};
 const ledger=makeLedger(async(url,init)=>{
  calls.push([new URL(url).pathname,JSON.parse(init.body)]);
  return Response.json({resumed:true,active:true});
 });
 assert.deepEqual(await ledger.resumePinnedPackageDispatch(
  ids.package,ids.destination,ids.root,ids.worker,ids.request,1,
  proof,stamp,ids.request),{resumed:true,active:true});
 assert.deepEqual(calls,[['/rest/v1/rpc/service_resume_pinned_package_dispatch',{
  p_package:ids.package,p_destination:ids.destination,p_root:ids.root,
  p_worker:ids.worker,p_request:ids.request,p_generation:1,
  p_account:proof.account,p_drive:proof.drive_id,p_permission:proof.permission_id,
  p_observed_at:stamp,p_proof_request:ids.request
 }]]);
 for(const args of [
  [ids.package,ids.destination,ids.root,'wrong',ids.request,1,proof,stamp,ids.request],
  [ids.package,ids.destination,ids.root,ids.worker,'wrong',1,proof,stamp,ids.request],
  [ids.package,ids.destination,ids.root,ids.worker,ids.request,0,proof,stamp,ids.request],
  [ids.package,ids.destination,'bad/root',ids.worker,ids.request,1,proof,stamp,ids.request],
  [ids.package,ids.destination,ids.root,ids.worker,ids.request,1,{...proof,permission_id:null},stamp,ids.request]
 ])assert.throws(()=>ledger.resumePinnedPackageDispatch(...args),
  e=>e.code==='PACKAGE_DISPATCH_SCOPE_INVALID');
 assert.equal(calls.length,1);
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


test('new step owner has exact service-only begin/complete calls and rejects invalid scope',async()=>{
 const calls=[];
 const ledger=makeLedger(async(url,init)=>{
  calls.push([new URL(url).pathname,JSON.parse(init.body)]);
  if(url.endsWith('/service_begin_package_dispatch_step'))
   return Response.json({acquired:false});
  if(url.endsWith('/service_complete_package_dispatch_step'))
   return Response.json({completed:true,step_id:ids.request});
  throw Error('UNEXPECTED_RPC');
 });
 const step='55555555-5555-4555-8555-555555555555';
 assert.deepEqual(await ledger.beginPackageStep(
  ids.package,ids.worker,ids.request,1,step),{acquired:false});
 assert.deepEqual(await ledger.completePackageStep(
  ids.package,ids.worker,ids.request,1,step,'VERIFIED_METADATA_STEP'),
  {completed:true,step_id:ids.request});
 assert.deepEqual(calls.map(x=>x[0]),[
  '/rest/v1/rpc/service_begin_package_dispatch_step',
  '/rest/v1/rpc/service_complete_package_dispatch_step'
 ]);
 assert.deepEqual(calls[0][1],{p_package:ids.package,p_worker:ids.worker,
  p_request:ids.request,p_generation:1,p_step:step});
 assert.deepEqual(calls[1][1],{...calls[0][1],p_outcome:'VERIFIED_METADATA_STEP'});
 for(const args of [
  [ids.package,ids.worker,ids.request,1,'bad'],
  [ids.package,ids.worker,ids.request,0,step],
  ['bad',ids.worker,ids.request,1,step]
 ])assert.throws(()=>ledger.beginPackageStep(...args),
  e=>e.code==='PACKAGE_STEP_SCOPE_INVALID');
 assert.throws(()=>ledger.completePackageStep(
  ids.package,ids.worker,ids.request,1,step,'UNCERTAIN'),
  e=>e.code==='PACKAGE_STEP_SCOPE_INVALID');
 assert.equal(calls.length,2);
});

test('missing durable package step RPC never falls back to legacy worker permit',async()=>{
 const paths=[];
 const ledger=makeLedger(async(url)=>{
  paths.push(new URL(url).pathname);
  return Response.json({error:'RPC unavailable'},{status:404});
 });
 const step='55555555-5555-4555-8555-555555555555';
 await assert.rejects(ledger.beginPackageStep(
  ids.package,ids.worker,ids.request,1,step),
  e=>e.code==='SERVICE_RPC_UNAVAILABLE');
 assert.deepEqual(paths,['/rest/v1/rpc/service_begin_package_dispatch_step']);
});


test('same-package duplicate wakeup cannot enter trusted provider step',async()=>{
 const {runFencedPackageDeliveryStep}=await import(
  '../../supabase/functions/client-delivery/worker-runtime.mjs');
 const scope={packageId:ids.package,workerId:ids.worker,requestId:ids.request,
  destinationId:ids.destination,rootId:ids.root,generation:1};
 const owner={active:true,package_id:ids.package,worker_id:ids.worker,
  request_id:ids.request,generation:1,destination_id:ids.destination,
  approved_sha256:'a'.repeat(64),manifest:{package_id:ids.package,
   destination_id:ids.destination,destination_root:ids.root}};
 let active=false,entered=0,completed=0,release,enteredSignal;
 const enteredPromise=new Promise(resolve=>{enteredSignal=resolve});
 const waiting=new Promise(resolve=>{release=resolve});
 const ledger={
  readPackageDispatchOwner:async()=>owner,
  beginPackageStep:async(pkg,worker,request,gen,step)=>{
   if(active)return {acquired:false};
   active=true;return {acquired:true,package_id:pkg,generation:gen,step_id:step};
  },
  completePackageStep:async(_p,_w,_r,_g,step)=>{
   completed++;active=false;return {completed:true,step_id:step};
  }
 };
 const first=runFencedPackageDeliveryStep({...scope,ledger,
  stepId:'55555555-5555-4555-8555-555555555555',
  runExistingStep:async()=>{entered++;enteredSignal();await waiting;
   return {state:'PARENT_STEP_VERIFIED'};}});
 await enteredPromise;
 const second=await runFencedPackageDeliveryStep({...scope,ledger,
  stepId:'66666666-6666-4666-8666-666666666666',
  runExistingStep:async()=>{entered++;return {state:'PARENT_STEP_VERIFIED'}}});
 assert.deepEqual(second,{state:'PACKAGE_STEP_BUSY'});
 assert.equal(entered,1);
 release();
 assert.deepEqual(await first,{state:'PARENT_STEP_VERIFIED'});
 assert.equal(completed,1);
});

test('ambiguous/partial delivery result retains exact step without any completion',async()=>{
 const {runFencedPackageDeliveryStep}=await import(
  '../../supabase/functions/client-delivery/worker-runtime.mjs');
 const scope={packageId:ids.package,workerId:ids.worker,requestId:ids.request,
  destinationId:ids.destination,rootId:ids.root,generation:1,
  stepId:'55555555-5555-4555-8555-555555555555'};
 const owner={active:true,package_id:ids.package,worker_id:ids.worker,
  request_id:ids.request,generation:1,destination_id:ids.destination,
  approved_sha256:'a'.repeat(64),manifest:{package_id:ids.package,
   destination_id:ids.destination,destination_root:ids.root}};
 let completed=0;
 const ledger={readPackageDispatchOwner:async()=>owner,
  beginPackageStep:async()=>({acquired:true,step_id:scope.stepId,
   package_id:scope.packageId,generation:1}),
  completePackageStep:async()=>{completed++;throw Error('NOT_ALLOWED')}};
 for(const state of ['FILE_STEP_PENDING','UNKNOWN'])
  await assert.rejects(runFencedPackageDeliveryStep({...scope,ledger,
   runExistingStep:async()=>({state})}),
   e=>e.code==='PACKAGE_STEP_REQUIRES_RECONCILIATION');
 assert.equal(completed,0);
});


test('verified final receipt is the only terminal step allowed to finish',async()=>{
 const {runFencedPackageDeliveryStep}=await import(
  '../../supabase/functions/client-delivery/worker-runtime.mjs');
 const step='55555555-5555-4555-8555-555555555555',calls=[];
 const ledger={readPackageDispatchOwner:async()=>({
   active:true,package_id:ids.package,worker_id:ids.worker,
   request_id:ids.request,generation:1,destination_id:ids.destination,
   approved_sha256:'a'.repeat(64),manifest:{
    package_id:ids.package,destination_id:ids.destination,destination_root:ids.root}
  }),
  beginPackageStep:async()=>({acquired:true,step_id:step,
   package_id:ids.package,generation:1}),
  completePackageStep:async(...args)=>{
   calls.push(args);return {completed:true,step_id:step};
  }};
 assert.deepEqual(await runFencedPackageDeliveryStep({ledger,
   packageId:ids.package,workerId:ids.worker,requestId:ids.request,generation:1,
   destinationId:ids.destination,rootId:ids.root,stepId:step,
   runExistingStep:async()=>({state:'PACKAGE_DELIVERED'})
 }),{state:'PACKAGE_DELIVERED'});
 assert.equal(calls.length,1);
 assert.equal(calls[0][5],'VERIFIED_FINAL_RECEIPT');
});

test('manifest-only zero-photo queue uses same fenced permit and verifies one step',async()=>{
 const {advancePinnedTestPackageOneStep}=await import(
  '../../supabase/functions/client-delivery/worker-runtime.mjs');
 const step='55555555-5555-4555-8555-555555555555';
 const owner={present:true,active:true,claimed:true,acquired:true,
  package_id:ids.package,destination_id:ids.destination,worker_id:ids.worker,
  request_id:ids.request,generation:1,approved_sha256:'a'.repeat(64),
  manifest:{package_id:ids.package,destination_id:ids.destination,
   destination_root:ids.root,selected_photos:[]}};
 let entered=0,completed=0,provider=0;
 const forbidden=async()=>{throw Error('UNEXPECTED_OPERATION')};
 const ledger={
  readPinnedPackageDispatch:async()=>owner,
  readPackageDispatchOwner:async()=>owner,
  beginPackageStep:async(_p,_w,_r,_g,id)=>{
   entered++;return {acquired:true,package_id:ids.package,generation:1,step_id:id};
  },
  completePackageStep:async(_p,_w,_r,_g,id,outcome)=>{
   completed++;assert.equal(outcome,'VERIFIED_METADATA_STEP');
   return {completed:true,step_id:id};
  },
  resumePinnedPackageDispatch:forbidden,
  claimPackageAndAcquireDispatch:forbidden,
  releasePackageDispatch:forbidden,
  recordPinnedPackageProviderCheck:forbidden
 };
 const actual=await advancePinnedTestPackageOneStep({
  ledger,packageId:ids.package,destinationId:ids.destination,rootId:ids.root,
  makeWorkerId:()=>step,advanceStep:async({packageClaim})=>{
   assert.deepEqual(packageClaim.manifest.selected_photos,[]);
   return {state:'PARENT_STEP_VERIFIED'};
  },
  verifyReadOnlyProvider:async()=>{provider++;throw Error('NO_EXTRA_PROVIDER')}
 });
 assert.deepEqual(actual,{state:'PARENT_STEP_VERIFIED'});
 assert.equal(entered,1);
 assert.equal(completed,1);
 assert.equal(provider,0);
 for(const bad of [null,Array(201).fill({photo_id:ids.worker})]){
  owner.manifest={...owner.manifest,selected_photos:bad};
  await assert.rejects(advancePinnedTestPackageOneStep({
   ledger,packageId:ids.package,destinationId:ids.destination,rootId:ids.root,
   makeWorkerId:()=>step,advanceStep:forbidden
  }),e=>e.code==='PACKAGE_DISPATCH_OWNER_UNVERIFIED');
 }
 assert.equal(entered,1,'malformed selections never begin another step');
});
