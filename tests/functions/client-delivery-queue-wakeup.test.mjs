// FWH-F04 queue wake source tests. No live SQL, Drive, cron or phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {advanceQueuedPackageOnce,isFwhTestQueueWorkerEnabled} from '../../supabase/functions/client-delivery/queue-wakeup.mjs';
import {createDeliveryHandler} from '../../supabase/functions/client-delivery/handler.mjs';
import {createServiceLedger} from '../../supabase/functions/client-delivery/service-ledger.mjs';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const candidate=n=>({available:true,package_id:uuid(n),
 destination_id:uuid(90),root_id:'synthetic_root_123456789'});
const SECRET='synthetic-test-worker-secret-12345678901234567890';
const BASE={
 workerSecret:SECRET,queueWorkerEnabled:true,enabled:false,
 testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
 testWorkspaceDomain:'example.invalid',expectedAccount:'worker@example.invalid',
 expectedDriveId:'synthetic_client_drive_12345',
 internalDriveId:'synthetic_internal_drive_54321',
 clientId:'synthetic-client-12345',clientSecret:'synthetic-client-secret',
 refreshToken:'synthetic-refresh-token',
 oauthScope:'https://www.googleapis.com/auth/drive',
 supabaseUrl:'https://fwh-test.supabase.co',
 serviceRoleJwt:'header.payload.signature',
 sessionVaultKey:Buffer.alloc(32,7).toString('base64').replace(/=+$/,'')
};
function request(body={operation:'advance_queued_package_once'},secret=SECRET){
 return new Request('https://fixture.invalid',{method:'POST',
  headers:{'content-type':'application/json','x-fwh-delivery-secret':secret},
  body:JSON.stringify(body)});
}
const status=async res=>({http:res.status,...await res.json()});
test('shipped source keeps old mutating modes hard OFF and TEST queue gated',()=>{
 const src=readFileSync(new URL('../../supabase/functions/client-delivery/index.ts',import.meta.url),'utf8');
 for(const mode of ['enabled','pinnedTestEnabled','twoPackageTestEnabled','testRecoveryEnabled']){
  assert.match(src,new RegExp('^ '+mode+':false,$','m'));
 }
 assert.match(src,/queueWorkerEnabled:isFwhTestQueueWorkerEnabled\(\{/);
 for(const item of ["'FWH_CLIENT_TEST_QUEUE_WORKER_ENABLED'","'SUPABASE_URL'",
  "'FWH_TEST_EVIDENCE_CLASS'"]){
  assert.ok(src.includes(item),'Missing exact TEST queue activation input: '+item);
 }
});
test('queue activation fails closed without flag, exact TEST URL and evidence',()=>{
 const valid={flag:'true',projectUrl:'https://vyocaujuwrivoqynvitm.supabase.co',
  evidenceClass:'DISPOSABLE_FWH_TEST_ONLY'};
 assert.equal(isFwhTestQueueWorkerEnabled(valid),true);
 for(const changed of [{flag:''},{flag:'false'},{flag:'TRUE'},
  {projectUrl:'https://different.supabase.co'},
  {projectUrl:'https://vyocaujuwrivoqynvitm.supabase.co/'},
  {projectUrl:'https://vyocaujuwrivoqynvitm.supabase.co.evil.test'},
  {evidenceClass:''},{evidenceClass:'PRODUCTION'}]){
  assert.equal(isFwhTestQueueWorkerEnabled({...valid,...changed}),false,
   JSON.stringify(changed));
 }
 assert.equal(isFwhTestQueueWorkerEnabled(),false);
});
test('server-selected queue is no-op when SQL dispatch gate is OFF',async()=>{
 let steps=0;
 const out=await advanceQueuedPackageOnce({
  ledger:{selectNextDeliveryPackage:async()=>({available:false})},
  runExisting:async()=>{steps++;return {state:'PACKAGE_DELIVERED'};}
 });
 assert.deepEqual(out,{state:'NO_ELIGIBLE_PACKAGES'});assert.equal(steps,0);
});
test('invalid/falsely selected IDs and roots are rejected before any provider step',async()=>{
 let steps=0;
 for(const candidateResponse of [
  {available:false,package_id:uuid(1)},
  {...candidate(1),package_id:'bad'},
  {...candidate(1),root_id:'bad/root'},
  {...candidate(1),root_id:BASE.expectedDriveId},
  {...candidate(1),root_id:BASE.internalDriveId},
  {...candidate(1),unexpected:'field'}
 ]){
  await assert.rejects(advanceQueuedPackageOnce({
   ledger:{selectNextDeliveryPackage:async()=>candidateResponse},
   expectedDriveId:BASE.expectedDriveId,internalDriveId:BASE.internalDriveId,
   runExisting:async()=>{steps++;}
  }),e=>e.code==='PACKAGE_DISPATCH_SCOPE_INVALID');
 }
 assert.equal(steps,0);
});
test('two selected independent packages reuse exactly one existing fenced step each',async()=>{
 const seen=[];
 for(const n of [1,2]){
  const result=await advanceQueuedPackageOnce({
   ledger:{selectNextDeliveryPackage:async()=>candidate(n)},
   expectedDriveId:BASE.expectedDriveId,internalDriveId:BASE.internalDriveId,
   runExisting:async p=>{
    seen.push([p.packageId,p.destinationId,p.rootId]);
    return {state:'PARENT_STEP_VERIFIED'};
   }
  });
  assert.equal(result.state,'PARENT_STEP_VERIFIED');
 }
 assert.deepEqual(seen,[[uuid(1),uuid(90),candidate(1).root_id],
  [uuid(2),uuid(90),candidate(2).root_id]]);
});
test('backend-only selection invokes one allowlisted read-only RPC, no global claim',async()=>{
 const calls=[];
 const ledger=createServiceLedger({
  url:BASE.supabaseUrl,serviceRoleJwt:BASE.serviceRoleJwt,
  fetcher:async(url,init)=>{
   calls.push([new URL(url).pathname,JSON.parse(init.body)]);
   return Response.json({available:false});
  }
 });
 assert.deepEqual(await ledger.selectNextDeliveryPackage(),{available:false});
 assert.deepEqual(calls,[['/rest/v1/rpc/service_select_next_delivery_package',{}]]);
});
test('queue route denies anonymous, changed operation or caller-chosen identity',async()=>{
 let network=0;
 const handler=createDeliveryHandler({...BASE,
  fetcher:async()=>{network++;throw Error('NO_NETWORK');},
  runQueueWorkerStep:async()=>{throw Error('NO_STEP');}
 });
 assert.equal((await handler(request(undefined,'wrong'))).status,401);
 for(const body of [{operation:'advance_queued_package_once',package_id:uuid(1)},
  {operation:'advance_once'},{}]){
  assert.deepEqual(await status(await handler(request(body))),
   {http:400,status:'EXACT_REQUEST_REQUIRED'});
 }
 assert.equal(network,0);
});
test('OFF and mutually exclusive worker modes cannot reach a provider',async()=>{
 let network=0;
 for(const overrides of [{queueWorkerEnabled:false},{enabled:true},
  {pinnedTestEnabled:true},{twoPackageTestEnabled:true},
  {testRecoveryEnabled:true},{testPreflightEnabled:true}]){
  const handler=createDeliveryHandler({...BASE,...overrides,
   fetcher:async()=>{network++;throw Error('NETWORK_FORBIDDEN');}});
  const actual=await status(await handler(request()));
  assert.equal(actual.http,503);
  assert.ok(['WORKER_NOT_ACTIVATED','CONFLICTING_WORKER_MODES'].includes(actual.status));
 }
 assert.equal(network,0);
});
test('enabled TEST queue route passes only backend-selected step to existing runner',async()=>{
 const seen=[],calls=[];
 const handler=createDeliveryHandler({...BASE,
  fetcher:async(url,init)=>{
   calls.push([new URL(url).pathname,JSON.parse(init.body)]);
   return Response.json(candidate(1));
  },
  runQueueWorkerStep:args=>{
   seen.push(Object.keys(args).sort());
   return Promise.resolve({state:'PARENT_STEP_VERIFIED'});
  }
 });
 const got=await status(await handler(request()));
 assert.deepEqual(got,{http:200,status:'PARENT_STEP_VERIFIED'});
 assert.equal(seen.length,1);
 assert.equal(seen[0].includes('packageId'),false);
 assert.equal(calls.length,0,'injected worker does not need provider calls');
});

test('GitHub TEST cron is offset every five minutes with single-wake safety intact',()=>{
 const flow=readFileSync(new URL('../../.github/workflows/fwh-test-delivery-wake.yml',import.meta.url),'utf8');
 assert.match(flow,/cron: "3-58\\/5 \\* \\* \\* \\*"/);
 assert.match(flow,/^  workflow_dispatch:$/m);
 assert.match(flow,/^  cancel-in-progress: false$/m);
 assert.match(flow,/--retry 0/);
 assert.match(flow,/--max-time 40/);
 assert.match(flow,/--data '\\{"operation":"advance_queued_package_once"\\}'/);
 assert.match(flow,/^    environment: fwh-test-delivery$/m);
});
