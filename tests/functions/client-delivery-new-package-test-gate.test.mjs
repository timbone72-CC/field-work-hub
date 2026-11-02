// SOURCE-ONLY disposable TEST new-package worker gate.
// Every backend/provider is a deterministic fake. No real SQL, Google or Send.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../supabase/functions/client-delivery/handler.mjs';
import {advancePinnedTestPackageOneStep} from '../../supabase/functions/client-delivery/worker-runtime.mjs';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const pkg=uuid(10),pkg2=uuid(11),old=uuid(1),dest=uuid(2);
const root='synthetic_client_root_0123456789';
const WORKER_KEY='disposable-test-worker-secret-12345678901234567890';
const config={
 workerSecret:WORKER_KEY,pinnedTestEnabled:true,
 pinnedTestPackageId:pkg,pinnedTestDestinationId:dest,
 pinnedTestRootFolderId:root,testReleasePackageId:old,
 testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
 expectedDriveId:'synthetic_external_drive_012345',
 internalDriveId:'synthetic_internal_drive_987654',
 expectedAccount:'fwh@example.invalid',testWorkspaceDomain:'example.invalid',
 clientId:'dummy-client-123',clientSecret:'dummy-secret-123',
 refreshToken:'dummy-refresh-123',
 oauthScope:'https://www.googleapis.com/auth/drive',
 supabaseUrl:'https://fwh-test.supabase.co',
 serviceRoleJwt:'header.payload.signature',
 sessionVaultKey:Buffer.alloc(32,7).toString('base64').replace(/=+$/,'')
};
const req=(body={operation:'new_test_package_step_once'},secret=WORKER_KEY)=>
 new Request('https://fixture.invalid',{method:'POST',headers:{
  'content-type':'application/json','x-fwh-delivery-secret':secret
 },body:JSON.stringify(body)});
const json=async r=>({http:r.status,status:(await r.json()).status});
const fixtureClaim=(packageId,workerId,requestId)=>({
 claimed:true,acquired:true,active:true,present:true,package_id:packageId,
 worker_id:workerId,request_id:requestId,generation:1,
 destination_id:dest,approved_sha256:'a'.repeat(64),
 manifest:{package_id:packageId,destination_id:dest,destination_root:root,
  selected_photos:[{photo_id:uuid(packageId===pkg?40:41)}]}
});
function fakeDatabase(){
 const permits=new Map(),activeSteps=new Map(),steps=[];
 let claimAttempts=0,legacyCalls=0,releases=0;
 return {
  permits,activeSteps,steps,get claimAttempts(){return claimAttempts},
  get legacyCalls(){return legacyCalls},get releases(){return releases},
  async readPinnedPackageDispatch(packageId,destinationId,rootId){
   assert.equal(destinationId,dest);assert.equal(rootId,root);
   const claim=permits.get(packageId);
   return claim?claim:{present:false,active:false};
  },
  async claimPackageAndAcquireDispatch(packageId,destinationId,rootId,worker,request){
   claimAttempts++;
   assert.equal(destinationId,dest);assert.equal(rootId,root);
   if(permits.has(packageId)||permits.size>=2)
    return {claimed:false,acquired:false};
   const claim=fixtureClaim(packageId,worker,request);
   permits.set(packageId,claim);return claim;
  },
  async readPackageDispatchOwner(packageId,worker,request,generation){
   const claim=permits.get(packageId);
   return claim&&claim.worker_id===worker&&claim.request_id===request&&
    claim.generation===generation?claim:{active:false};
  },
  async beginPackageStep(packageId,worker,request,gen,step){
   assert.equal(worker,permits.get(packageId)?.worker_id);
   assert.equal(request,permits.get(packageId)?.request_id);
   assert.equal(gen,1);
   if(activeSteps.has(packageId))return {acquired:false};
   activeSteps.set(packageId,step);steps.push([packageId,'BEGIN',step]);
   return {acquired:true,step_id:step,package_id:packageId,generation:gen};
  },
  async completePackageStep(packageId,worker,request,gen,step,outcome){
   assert.equal(worker,permits.get(packageId)?.worker_id);
   assert.equal(request,permits.get(packageId)?.request_id);
   assert.equal(gen,1);assert.equal(activeSteps.get(packageId),step);
   steps.push([packageId,'COMPLETE',outcome]);activeSteps.delete(packageId);
   return {completed:true,step_id:step};
  },
  async releasePackageDispatch(packageId,worker,request,generation){
   assert.equal(worker,permits.get(packageId)?.worker_id);
   assert.equal(request,permits.get(packageId)?.request_id);
   assert.equal(generation,1);assert.equal(activeSteps.has(packageId),false);
   releases++;permits.delete(packageId);return {released:true};
  },
  readActiveLease(){legacyCalls++;throw Error('LEGACY_READ_FORBIDDEN')},
  acquireDispatch(){legacyCalls++;throw Error('LEGACY_ACQUIRE_FORBIDDEN')},
  releaseDispatch(){legacyCalls++;throw Error('LEGACY_RELEASE_FORBIDDEN')},
  claim(){legacyCalls++;throw Error('BROAD_CLAIM_FORBIDDEN')}
 };
}
const ids=()=>{let n=100;return ()=>uuid(++n)};
const execute=(ledger,packageId,makeWorkerId,advanceStep)=>
 advancePinnedTestPackageOneStep({ledger,packageId,destinationId:dest,rootId:root,
  makeWorkerId,tokenProvider:async()=>({}),expectedEmail:config.expectedAccount,
  expectedDriveId:config.expectedDriveId,
  advanceStep,fetcher:async()=>{throw Error('REAL_IO_FORBIDDEN')}});
test('new operation OFF by default and rejects worker-secret bypass',async()=>{
 let called=0;
 const settings={...config,runPinnedTestStep:async()=>{called++;return {state:'PACKAGE_IDENTITIES_PREALLOCATED'}}};
 assert.deepEqual(await json(await createDeliveryHandler({
  ...settings,pinnedTestEnabled:false})(req())),
  {http:503,status:'WORKER_NOT_ACTIVATED'});
 assert.deepEqual(await json(await createDeliveryHandler(settings)(req(undefined,'bad'))),
  {http:401,status:'WORKER_UNAUTHORIZED'});
 assert.equal(called,0);
});
test('new operation accepts only empty-identity command and distinct server pin',async()=>{
 let passed,called=0;
 const handler=createDeliveryHandler({...config,testPreflightEnabled:true,
  runPinnedTestStep:async args=>{passed=args;called++;return {state:'PACKAGE_IDENTITIES_PREALLOCATED'}}});
 for(const body of [
  {operation:'advance_once'}, {operation:'new_test_package_step_once',package_id:pkg},
  {operation:'new_test_package_step_once',worker_id:uuid(3)},
  {operation:'new_test_package_step_once',force:true},
  {operation:'new_test_package_step_once',destination_id:dest}
 ])assert.deepEqual(await json(await handler(req(body))),
  {http:400,status:'EXACT_REQUEST_REQUIRED'});
 assert.equal(called,0);
 assert.deepEqual(await json(await handler(req())),
  {http:200,status:'PREALLOCATED_ONLY'});
 assert.equal(passed.packageId,pkg);
 assert.equal(passed.destinationId,dest);
 assert.equal(passed.rootId,root);
 assert.equal(called,1);
 const oldPin=createDeliveryHandler({...config,pinnedTestPackageId:old,
  runPinnedTestStep:async()=>{throw Error('MUST_NOT_RUN')}});
 assert.deepEqual(await json(await oldPin(req())),
  {http:503,status:'NEW_TEST_SCOPE_NOT_CONFIGURED'});
 const both=createDeliveryHandler({...config,enabled:true,
  runPinnedTestStep:async()=>{throw Error('MUST_NOT_RUN')}});
 assert.deepEqual(await json(await both(req())),
  {http:503,status:'CONFLICTING_WORKER_MODES'});
});
test('pinned worker never calls legacy lease; same-package duplicate wakeup serializes',async()=>{
 const ledger=fakeDatabase(),newId=ids();
 let entered,allow;
 const started=new Promise(r=>{entered=r});
 const gate=new Promise(r=>{allow=r});
 let count=0;
 const slow=execute(ledger,pkg,newId,async args=>{
  assert.equal(args.packageClaim.package_id,pkg);
  count++;entered();await gate;
  return {state:'PARENT_STEP_VERIFIED'};
 });
 await started;
 const duplicate=await execute(ledger,pkg,newId,async()=>{count++;throw Error('DUPLICATE_PROVIDER_WRITE')});
 assert.deepEqual(duplicate,{state:'PACKAGE_STEP_BUSY'});
 assert.equal(count,1);
 allow();
 assert.deepEqual(await slow,{state:'PARENT_STEP_VERIFIED'});
 assert.equal(ledger.activeSteps.size,0);
 assert.equal(ledger.claimAttempts,1);
 assert.equal(ledger.legacyCalls,0);
});
test('new TEST package with uncertain provider outcome stays held while unrelated package progresses',async()=>{
 const ledger=fakeDatabase(),newId=ids();
 await assert.rejects(execute(ledger,pkg,newId,async()=>{throw Error('GOOGLE_503_UNCERTAIN')}),
  /GOOGLE_503_UNCERTAIN/);
 assert.equal(ledger.activeSteps.has(pkg),true);
 assert.deepEqual(await execute(ledger,pkg,newId,async()=>{
  throw Error('BLIND_RETRY_FORBIDDEN')}),
  {state:'PACKAGE_STEP_BUSY'});
 assert.deepEqual(await execute(ledger,pkg2,newId,async()=>({state:'PARENT_STEP_VERIFIED'})),
  {state:'PARENT_STEP_VERIFIED'});
 assert.equal(ledger.activeSteps.has(pkg2),false);
 assert.equal(ledger.activeSteps.has(pkg),true);
 assert.equal(ledger.legacyCalls,0);
 assert.equal(ledger.releases,0);
});
test('durably confirmed chunk progress allows a next step, but uncertain offset remains held',async()=>{
 const ledger=fakeDatabase(),newId=ids();
 assert.deepEqual(await execute(ledger,pkg,newId,
  async()=>({state:'FILE_STEP_PROGRESS_VERIFIED'})),
  {state:'FILE_STEP_PROGRESS_VERIFIED'});
 assert.equal(ledger.activeSteps.has(pkg),false);
 await assert.rejects(execute(ledger,pkg,newId,
  async()=>({state:'FILE_STEP_PENDING'})),
  e=>e.code==='PACKAGE_STEP_REQUIRES_RECONCILIATION');
 assert.equal(ledger.activeSteps.has(pkg),true);
 assert.deepEqual(await execute(ledger,pkg,newId,
  async()=>{throw Error('UNAUTHORIZED_OFFSET_REPLAY')}),
  {state:'PACKAGE_STEP_BUSY'});
});
test('lost SQL claim acknowledgement never starts Google or invokes legacy fallback',async()=>{
 const ledger=fakeDatabase(),newId=ids();
 ledger.claimPackageAndAcquireDispatch=async()=>{throw Error('SQL_ACK_LOST')};
 let provider=0;
 await assert.rejects(execute(ledger,pkg,newId,async()=>{provider++}),
  /SQL_ACK_LOST/);
 assert.equal(provider,0);
 assert.equal(ledger.legacyCalls,0);
});
test('only verified final delivery can close a package slot',async()=>{
 const ledger=fakeDatabase(),newId=ids();
 assert.deepEqual(await execute(ledger,pkg,newId,
  async()=>({state:'PACKAGE_DELIVERED'})),
  {state:'PACKAGE_DELIVERED'});
 assert.equal(ledger.releases,1);
 assert.equal(ledger.permits.size,0);
});
