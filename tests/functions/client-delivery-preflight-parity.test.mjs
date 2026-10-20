// Prevent a future hosted worker deployment from changing the accepted
// read-only v11 client TEST provider preflight/diagnostics.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyTestHandler}
  from '../../supabase/functions/client-delivery/test-preflight-only.mjs';
import {createDeliveryHandler}
  from '../../supabase/functions/client-delivery/handler.mjs';

const secret='DISPOSABLE-TEST-worker-secret-0123456789';
const expected={
  workerSecret:secret,expectedEmail:'office@fixture.invalid',
  expectedDriveId:'fixture_client_drive_1234567',
  testRootFolderId:'fixture_client_root_12345678',
  internalDriveId:'fixture_internal_drive_123456',
  testWorkspaceDomain:'fixture.invalid',
  testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
  clientId:'fixture-client-id-1234567890',
  clientSecret:'fixture-client-secret-1234567890',
  refreshToken:'fixture-refresh-token-1234567890',
  oauthScope:'https://www.googleapis.com/auth/drive'
};
const oldOptions=({
  deliveryActive:false,testEnabled:true,
  workerSecret:expected.workerSecret,
  expectedEmail:expected.expectedEmail,
  expectedDriveId:expected.expectedDriveId,
  clientRootId:expected.testRootFolderId,
  internalDriveId:expected.internalDriveId,
  workspaceDomain:expected.testWorkspaceDomain,
  testEvidenceClass:expected.testEvidenceClass,
  clientId:expected.clientId,clientSecret:expected.clientSecret,
  refreshToken:expected.refreshToken,oauthScope:expected.oauthScope
});
const toOld=override=>Object.fromEntries(
 Object.entries(override).map(([key,value])=>[
  ({testRootFolderId:'clientRootId',
    testWorkspaceDomain:'workspaceDomain',
    testPreflightEnabled:'testEnabled',enabled:'deliveryActive'}[key]??key),value
 ])
);
function transport({error=false,wrongDrive=false}={}){
 const calls=[];
 const fetcher=async(raw,options={})=>{
  const u=new URL(raw),method=options.method??'GET';
  calls.push([u.origin,u.pathname,method]);
  if(error)throw Error('DO_NOT_LEAK_TEST_CREDENTIAL');
  if(u.pathname==='/token')return Response.json({
   token_type:'Bearer',access_token:'disposable-test-oauth-access-token-123456789',
   expires_in:3600,scope:'https://www.googleapis.com/auth/drive'
  });
  if(u.pathname==='/drive/v3/about')return Response.json({
   user:{emailAddress:expected.expectedEmail,me:true,
     permissionId:'fixture-permission-id'}
  });
  if(u.pathname==='/drive/v3/files/'+expected.testRootFolderId)
   return Response.json({
    id:expected.testRootFolderId,
    driveId:wrongDrive?expected.internalDriveId:expected.expectedDriveId,
    mimeType:'application/vnd.google-apps.folder',
    trashed:false,capabilities:{canAddChildren:true}
   });
  throw Error('UNEXPECTED_PROVIDER_PATH');
 };
 return {fetcher,calls};
}
function request(raw='{"operation":"verify_test_connection"}',{
  key=secret,method='POST',contentType='application/json'
}={}){
 return new Request('https://not-real.invalid/functions/v1/client-delivery',{
  method,headers:{'x-fwh-delivery-secret':key,
   'content-type':contentType},...(method==='POST'?{body:raw}:{})
 });
}
async function compare(raw,override={},options={}){
 const a=transport(options),b=transport(options);
 const previous=createReadOnlyTestHandler({...oldOptions,
  ...toOld(override),fetcher:a.fetcher});
 const current=createDeliveryHandler({...expected,
  enabled:false,testPreflightEnabled:true,...override,
  // The original read-only adapter names this argument expectedEmail;
  // the joined worker's existing option is named expectedAccount.
  expectedAccount:override.expectedEmail??expected.expectedEmail,
  fetcher:b.fetcher});
 const old=await previous(request(raw)),now=await current(request(raw));
 assert.equal(now.status,old.status);
 assert.equal(await now.text(),await old.text());
 assert.deepEqual(b.calls,a.calls);
 return {status:now.status,calls:b.calls};
}

test('hosted v11 success stays byte-identical with the guarded future entry',async()=>{
 const {status,calls}=await compare();
 assert.equal(status,200);
 assert.deepEqual(calls.map(x=>x[1]),[
  '/token','/drive/v3/about','/drive/v3/files/'+expected.testRootFolderId
 ]);
 assert.deepEqual(calls.map(x=>x[2]),['POST','GET','GET']);
});

test('hosted v11 exact error diagnostics and provider-denial semantics are retained',async()=>{
 for(const override of [
  {testEvidenceClass:''},{testRootFolderId:''},
  {testRootFolderId:expected.expectedDriveId},
  {expectedDriveId:expected.internalDriveId},
  {internalDriveId:expected.testRootFolderId},
  {testWorkspaceDomain:'other.invalid'},
  {expectedEmail:'office@other.invalid'},
  {clientId:''},{clientSecret:''},{refreshToken:''},
  {oauthScope:'https://www.googleapis.com/auth/drive.readonly'}
 ]){
  const result=await compare(undefined,override);
  assert.equal(result.status,503);
  assert.deepEqual(result.calls,[]);
 }
 for(const bad of [{error:true},{wrongDrive:true}]){
  const result=await compare(undefined,{},bad);
  assert.equal(result.status,503);
 }
});

test('hosted v11 strict input limits and unsupported operations stay denied',async()=>{
 for(const raw of [
  '{"operation":"preallocate"}',
  '{"operation":"advance_once"}',
  '{"operation":"send"}',
  '{"operation":"verify_test_connection","package_id":"other"}',
  '{}','[]','{',
  '{"operation":"verify_test_connection"}'+' '.repeat(210)
 ]){
  const result=await compare(raw);
  assert.ok([400,413].includes(result.status));
  assert.deepEqual(result.calls,[]);
 }
});

test('test-only operation never acquires active-worker permit or makes provider calls',async()=>{
 let requests=0;
 const h=createDeliveryHandler({...expected,enabled:true,
   testPreflightEnabled:false,
   supabaseUrl:'https://fwh-test.supabase.co',
   serviceRoleJwt:'header.payload.signature',
   fetcher:()=>{requests++;throw Error('UNEXPECTED_NETWORK');}});
 const active=await h(request());
 assert.equal(active.status,400);
 assert.deepEqual(await active.json(),{status:'EXACT_REQUEST_REQUIRED'});
 assert.equal(requests,0);
 const both=await createDeliveryHandler({...expected,enabled:true,
   testPreflightEnabled:true,fetcher:()=>{requests++;throw Error('UNEXPECTED');}})
   (request());
 assert.equal(both.status,503);
 assert.equal(requests,0);
});
