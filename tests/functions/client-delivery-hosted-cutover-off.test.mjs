// FWH TEST hosted cutover staging: legacy, general, prior one-package and
// new two-package mutations all stay compiled OFF; provider reads are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDeliveryHandler} from '../../supabase/functions/client-delivery/handler.mjs';

const source=readFileSync(new URL('../../supabase/functions/client-delivery/index.ts',import.meta.url),'utf8');

test('hosted staging hard-disables all mutating modes, without a package pin',()=>{
 for(const key of ['enabled','testRecoveryEnabled','pinnedTestEnabled','twoPackageTestEnabled']){
  const line=source.split('\n').find(x=>new RegExp('^\\s*'+key+':').test(x));
  assert.equal(line?.trim(),key+':false,',key+' must be hard OFF');
 }
 assert.match(source,/testPreflightEnabled:Deno\.env\.get\('FWH_CLIENT_TEST_PREFLIGHT_ENABLED'\)/);
 assert.match(source,/^\s*twoPackageTestPins:\[\],/m);
 for(const key of ['pinnedTestPackageId','pinnedTestDestinationId','pinnedTestRootFolderId']){
  assert.match(source,new RegExp('^\\s*'+key+':\\'\\',','m'));
 }
});

test('old frozen delivery identity is absent from current hosted entry, not erased from ledger',()=>{
 for(const previous of [
  'f42e05df-de7a-4d20-8dee-f55e09511d1f',
  '06f157eb-230c-44b5-b3d4-a7508110bfd7',
  '1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK'
 ])assert.equal(source.includes(previous),false,'old TEST pin retained in staging');
 for(const name of ['FWH_CLIENT_NEW_TEST_PACKAGE_ID','FWH_CLIENT_NEW_TEST_DESTINATION_ID','FWH_CLIENT_NEW_TEST_ROOT_FOLDER_ID']){
  assert.equal(source.includes(name),false,'Environment-selected TEST identity bypass: '+name);
 }
});

test('historical one-package synthetic handler only accepts its frozen envelope',async()=>{
 const secret='synthetic-test-worker-secret-12345678901234567890';
 const packageId='f42e05df-de7a-4d20-8dee-f55e09511d1f';
 const destinationId='06f157eb-230c-44b5-b3d4-a7508110bfd7';
 const rootId='1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK';
 let calls=0;
 const handler=createDeliveryHandler({
  enabled:false,testRecoveryEnabled:false,pinnedTestEnabled:true,
  pinnedTestPackageId:packageId,pinnedTestDestinationId:destinationId,
  pinnedTestRootFolderId:rootId,
  testReleasePackageId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
  testWorkspaceDomain:'fixture.invalid',expectedAccount:'test@fixture.invalid',
  expectedDriveId:'synthetic_shared_drive_1234',
  internalDriveId:'synthetic_internal_drive_5678',
  clientId:'synthetic-client',clientSecret:'synthetic-secret',
  refreshToken:'synthetic-refresh',oauthScope:'https://www.googleapis.com/auth/drive',
  supabaseUrl:'https://fixture.invalid',serviceRoleJwt:'synthetic-service-role',
  sessionVaultKey:'unused-by-mocked-step',workerSecret:secret,
  runPinnedTestStep:async args=>{
   calls++;
   assert.equal(args.packageId,packageId);
   assert.equal(args.destinationId,destinationId);
   assert.equal(args.rootId,rootId);
   return {state:'PACKAGE_IDENTITIES_PREALLOCATED'};
  }
 });
 const req=(value,key=secret)=>new Request('https://fixture.invalid',{
  method:'POST',
  headers:{'content-type':'application/json','x-fwh-delivery-secret':key},
  body:JSON.stringify(value)});
 for(const operation of ['advance_once','preallocate',
     'continue_original_saved_first_photo_once','verify_test_connection']){
  const response=await handler(req({operation}));
  assert.equal(response.status,400,operation);
  assert.equal((await response.json()).status,'EXACT_REQUEST_REQUIRED');
 }
 const wrong=await handler(req({operation:'new_test_package_step_once'},'bad'));
 assert.equal(wrong.status,401);
 const extra=await handler(req({operation:'new_test_package_step_once',package_id:packageId}));
 assert.equal(extra.status,400);
 assert.equal(calls,0);
 // On the real hosted worker, the AES, Google and SQL checks must also pass.
 // This test proves only the restricted dispatch envelope, not provider success.
});

test('disabled trusted handler refuses even authenticated delivery/recovery operations',async()=>{
 let providerCalls=0;
 const handler=createDeliveryHandler({
  enabled:false,testRecoveryEnabled:false,pinnedTestEnabled:false,
  twoPackageTestEnabled:false,twoPackageTestPins:[],
  workerSecret:'synthetic-worker-secret-1234567890123456789012',
  runPinnedTestStep:async()=>{providerCalls++;throw Error('NO_PROVIDER');}
 });
 for(const operation of ['advance_once','preallocate','continue_original_saved_first_photo_once',
  'new_test_package_step_once','new_test_package_slot_1_step_once','new_test_package_slot_2_step_once']){
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',
   headers:{'content-type':'application/json',
    'x-fwh-delivery-secret':'synthetic-worker-secret-1234567890123456789012'},
   body:JSON.stringify({operation})}));
  assert.equal(response.status,503);
  assert.equal((await response.json()).status,'WORKER_NOT_ACTIVATED');
 }
 assert.equal(providerCalls,0);
});
