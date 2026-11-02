// Temporary hosted FWH TEST cutover contract: all provider-mutating paths
// MUST be compile-time OFF until old Edge workers have been retired.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDeliveryHandler} from '../../supabase/functions/client-delivery/handler.mjs';

const source=readFileSync(new URL('../../supabase/functions/client-delivery/index.ts',import.meta.url),'utf8');

test('hosted cutover explicitly overrides all provider mutation environment flags',()=>{
 for(const key of ['enabled','testRecoveryEnabled','pinnedTestEnabled']){
  const line=source.split('\n').find(x=>new RegExp('^\\s*'+key+':').test(x));
  assert.equal(line?.trim(),key+':false,',key+' must be hard OFF');
 }
 assert.match(source,/testPreflightEnabled:Deno\.env\.get\('FWH_CLIENT_TEST_PREFLIGHT_ENABLED'\)/);
});

test('one approved TEST package is pinned in source while every provider mutation stays OFF',()=>{
 const mustHave=[
  "pinnedTestPackageId:'f42e05df-de7a-4d20-8dee-f55e09511d1f',",
  "pinnedTestDestinationId:'06f157eb-230c-44b5-b3d4-a7508110bfd7',",
  "pinnedTestRootFolderId:'1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK',",
  'enabled:false,','testRecoveryEnabled:false,','pinnedTestEnabled:false,'
 ];
 for(const expected of mustHave)assert.ok(source.includes(expected),'Missing server-pin '+expected);
 for(const name of ['FWH_CLIENT_NEW_TEST_PACKAGE_ID','FWH_CLIENT_NEW_TEST_DESTINATION_ID','FWH_CLIENT_NEW_TEST_ROOT_FOLDER_ID']){
  assert.ok(!source.includes(name),'Environment-selected TEST identity bypass: '+name);
 }
});

test('disabled trusted handler refuses even authenticated delivery/recovery operations',async()=>{
 let providerCalls=0;
 const handler=createDeliveryHandler({
  enabled:false,testRecoveryEnabled:false,pinnedTestEnabled:false,
  workerSecret:'synthetic-worker-secret-1234567890123456789012',
  runPinnedTestStep:async()=>{providerCalls++;throw Error('NO_PROVIDER');}
 });
 for(const operation of ['advance_once','preallocate','continue_original_saved_first_photo_once','new_test_package_step_once']){
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',
   headers:{'content-type':'application/json',
    'x-fwh-delivery-secret':'synthetic-worker-secret-1234567890123456789012'},
   body:JSON.stringify({operation})}));
  assert.equal(response.status,503);
  assert.equal((await response.json()).status,'WORKER_NOT_ACTIVATED');
 }
 assert.equal(providerCalls,0);
});
