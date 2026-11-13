// Event transport tests. No live SQL, notification, provider or Send.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../supabase/functions/client-delivery/handler.mjs';

const TICKET='00000000-0000-4000-8000-000000000001';
const TOKEN='a'.repeat(64);
const BASE={
 queueWorkerEnabled:true,eventWakeEnabled:true,
 testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
 testWorkspaceDomain:'example.invalid',expectedAccount:'worker@example.invalid',
 expectedDriveId:'synthetic_client_drive_12345',internalDriveId:'synthetic_internal_drive_54321',
 clientId:'synthetic-client-12345',clientSecret:'synthetic-client-secret',
 refreshToken:'synthetic-refresh-token',oauthScope:'https://www.googleapis.com/auth/drive',
 supabaseUrl:'https://vyocaujuwrivoqynvitm.supabase.co',serviceRoleJwt:'header.payload.signature',
 sessionVaultKey:Buffer.alloc(32,7).toString('base64').replace(/=+$/,'')
};
function request({ticket=TICKET,token=TOKEN,body={operation:'advance_queued_package_once'}}={}){
 return new Request('https://fixture.invalid',{method:'POST',headers:{
  'content-type':'application/json','x-fwh-wake-id':ticket,'x-fwh-wake-token':token
 },body:JSON.stringify(body)});
}
test('event credential defaults OFF and rejects wrong TEST boundary before network',async()=>{
 for(const changed of [{eventWakeEnabled:undefined},{eventWakeEnabled:false},
  {queueWorkerEnabled:false},{supabaseUrl:'https://different.supabase.co'},
  {testEvidenceClass:'PRODUCTION'}]){
  let network=0,steps=0;
  const handler=createDeliveryHandler({...BASE,...changed,
   fetcher:async()=>{network++;throw Error('forbidden');},
   runQueueWorkerStep:async()=>{steps++;}});
  assert.equal((await handler(request())).status,401);
  assert.equal(network,0);assert.equal(steps,0);
 }
});
test('malformed credentials and caller-selected package cannot consume or run work',async()=>{
 let network=0,steps=0;
 const handler=createDeliveryHandler({...BASE,
  fetcher:async()=>{network++;throw Error('forbidden');},
  runQueueWorkerStep:async()=>{steps++;}});
 for(const input of [{ticket:'invalid'},{token:''},{token:'a'.repeat(65)},
  {token:'A'.repeat(64)}])assert.equal((await handler(request(input))).status,401);
 assert.equal((await handler(request({body:{operation:'advance_queued_package_once',package_id:TICKET}}))).status,400);
 assert.equal(network,0);assert.equal(steps,0);
});
test('valid one-use admission runs exactly one existing step; replay cannot reach provider',async()=>{
 let admission=0,steps=0;
 const handler=createDeliveryHandler({...BASE,
  fetcher:async(url,init)=>{
   assert.equal(new URL(url).pathname,'/rest/v1/rpc/service_consume_client_delivery_wake');
   assert.deepEqual(JSON.parse(init.body),{p_ticket:TICKET,p_token:TOKEN});
   return Response.json({accepted:++admission===1});
  },
  runQueueWorkerStep:async args=>{
   steps++;assert.equal('packageId' in args,false);
   return {state:'PARENT_STEP_VERIFIED'};
  }});
 const first=await handler(request());
 assert.equal(first.status,200);assert.deepEqual(await first.json(),{status:'PARENT_STEP_VERIFIED'});
 assert.equal((await handler(request())).status,401);
 assert.equal(admission,2);assert.equal(steps,1);
});
test('denied, expired or unconfirmed admission cannot run a provider step',async()=>{
 for(const response of [{accepted:false},{accepted:true,unexpected:true},null]){
  let steps=0;
  const handler=createDeliveryHandler({...BASE,fetcher:async()=>Response.json(response),
   runQueueWorkerStep:async()=>{steps++;}});
  assert.equal((await handler(request())).status,401);assert.equal(steps,0);
 }
 let steps=0;
 const handler=createDeliveryHandler({...BASE,fetcher:async()=>{throw Error('lost admission');},
  runQueueWorkerStep:async()=>{steps++;}});
 assert.equal((await handler(request())).status,503);assert.equal(steps,0);
});
test('conflicting worker modes deny before ticket consumption',async()=>{
 for(const mode of ['enabled','pinnedTestEnabled','twoPackageTestEnabled','testRecoveryEnabled','testPreflightEnabled']){
  let network=0;
  const handler=createDeliveryHandler({...BASE,[mode]:true,
   fetcher:async()=>{network++;throw Error('forbidden');}});
  assert.equal((await handler(request())).status,503);assert.equal(network,0);
 }
});
