import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createReadOnlyTestHandler} from '../../supabase/functions/client-delivery/test-preflight-only.mjs';

const KEY='disposable-private-worker-key-01234567890abcdef';
const ROOT='disposable_client_root_01234567';
const DRIVE='disposable_client_drive_123456';
const INTERNAL='disposable_internal_drive_9876543';
const ACCOUNT='test@disposable.invalid';
const ACCESS='fake-google-access-token-012345678900';
const base={
 deliveryActive:false,testEnabled:true,testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
 workerSecret:KEY,expectedEmail:ACCOUNT,expectedDriveId:DRIVE,clientRootId:ROOT,
 internalDriveId:INTERNAL,workspaceDomain:'disposable.invalid',
 clientId:'dummy-client-id-0123456789',clientSecret:'dummy-client-secret-0123456789',
 refreshToken:'dummy-refresh-token-0123456789',
 oauthScope:'https://www.googleapis.com/auth/drive'
};
const request=(operation='verify_test_connection',key=KEY)=>new Request('https://fixture.invalid/',{
 method:'POST',headers:{'content-type':'application/json','x-fwh-delivery-secret':key},
 body:JSON.stringify({operation})
});
const provider=(change={})=>{
 const calls=[];
 const fetcher=async(url,opts={})=>{
  const u=new URL(url),method=opts.method??'GET';
  calls.push({origin:u.origin,path:u.pathname,method});
  if(change.networkFail)throw Error('SENSITIVE_PRIVATE_GOOGLE_ERROR');
  if(u.origin==='https://oauth2.googleapis.com'){
   assert.equal(method,'POST');
   assert.equal(u.pathname,'/token');
   const fields=new URLSearchParams(opts.body);
   assert.equal(fields.get('grant_type'),'refresh_token');
   return Response.json({token_type:'Bearer',access_token:ACCESS,
    expires_in:3600,scope:'https://www.googleapis.com/auth/drive'});
  }
  assert.equal(u.origin,'https://www.googleapis.com');
  assert.equal(method,'GET');
  assert.equal(opts.headers.Authorization,'Bearer '+ACCESS);
  if(u.pathname==='/drive/v3/about')return Response.json({
   user:{emailAddress:change.email??ACCOUNT,me:true,permissionId:'abc123'}
  });
  if(u.pathname==='/drive/v3/files/'+ROOT)return Response.json({
   id:ROOT,trashed:false,mimeType:'application/vnd.google-apps.folder',
   driveId:change.driveId??DRIVE,
   capabilities:{canAddChildren:change.writable??true}
  });
  throw Error('Unexpected provider endpoint');
 };
 return {calls,fetcher};
};
test('TEST-only hosted adapter uses exact OAuth refresh + 2 Google read endpoints',async()=>{
 const mock=provider();
 const result=await createReadOnlyTestHandler({...base,fetcher:mock.fetcher})(request());
 assert.equal(result.status,200);
 assert.equal(await result.text(),'{"status":"TEST_PROVIDER_VERIFIED_READ_ONLY"}');
 assert.deepEqual(mock.calls,[
  {origin:'https://oauth2.googleapis.com',path:'/token',method:'POST'},
  {origin:'https://www.googleapis.com',path:'/drive/v3/about',method:'GET'},
  {origin:'https://www.googleapis.com',path:'/drive/v3/files/'+ROOT,method:'GET'}
 ]);
 assert.equal(result.headers.get('Access-Control-Allow-Origin'),null);
 assert.equal(result.headers.get('Cache-Control'),'no-store, private');
});
test('backend worker secret gates all provider IO, including wrong key and GETs',async()=>{
 const mock=provider(),h=createReadOnlyTestHandler({...base,fetcher:mock.fetcher});
 for(const k of ['',KEY.slice(0,-1),KEY+'x','sb_publishable_public']){
  const response=await h(request('verify_test_connection',k));
  assert.equal(response.status,401);
 }
 assert.equal((await h(new Request('https://fixture.invalid/'))).status,405);
 assert.equal(mock.calls.length,0);
});
test('full delivery switch, absent TEST flag, wrong roots or missing evidence stop before Google',async()=>{
 const diffs=[
  {deliveryActive:true},{testEnabled:false},{testEvidenceClass:''},
  {workerSecret:''},{workspaceDomain:'wrong.invalid'},
  {clientRootId:DRIVE},{internalDriveId:DRIVE},{clientRootId:INTERNAL},
  {oauthScope:'https://www.googleapis.com/auth/gmail.readonly'}
 ];
 for(const diff of diffs){
  const mock=provider(),r=await createReadOnlyTestHandler({...base,...diff,fetcher:mock.fetcher})(request());
  assert.notEqual(r.status,200,JSON.stringify(diff));
  assert.equal(mock.calls.length,0,JSON.stringify(diff));
 }
});

test('private TEST configuration failure identifies names only; never credential values',async()=>{
 const mock=provider();
 const errors={
  testEvidenceClass:'WRONG_EVIDENCE_CLASS',
  clientRootId:'BAD_ROOT',
  expectedDriveId:'BAD_DRIVE',
  internalDriveId:'BAD',
  workspaceDomain:'not a domain',
  expectedEmail:'test@not a domain',
  clientId:'',
  clientSecret:'',
  refreshToken:'',
  oauthScope:''
 };
 const response=await createReadOnlyTestHandler({...base,...errors,fetcher:mock.fetcher})(request());
 assert.equal(response.status,503);
 const report=await response.json();
 assert.equal(report.status,'TEST_PROVIDER_NOT_CONFIGURED');
 assert.deepEqual(report.invalid_fields,[
  'FWH_TEST_EVIDENCE_CLASS','FWH_CLIENT_TEST_ROOT_FOLDER_ID',
  'FWH_CLIENT_SHARED_DRIVE_ID','FWH_INTERNAL_SHARED_DRIVE_ID',
  'FWH_TEST_WORKSPACE_DOMAIN','FWH_GOOGLE_OAUTH_CLIENT_ID',
  'FWH_GOOGLE_OAUTH_CLIENT_SECRET','FWH_GOOGLE_OAUTH_REFRESH_TOKEN',
  'FWH_GOOGLE_OAUTH_SCOPE'
 ]);
 const raw=JSON.stringify(report);
 for(const privateValue of [KEY,ROOT,DRIVE,INTERNAL,ACCOUNT,base.clientId,
    base.clientSecret,base.refreshToken,errors.clientRootId]){
  assert.equal(raw.includes(privateValue),false,'no configured value may be echoed');
 }
 assert.equal(mock.calls.length,0);
 const unauthorized=await createReadOnlyTestHandler({...base,...errors,fetcher:mock.fetcher})(request('verify_test_connection','wrong'));
 assert.equal(unauthorized.status,401);
 assert.deepEqual(await unauthorized.json(),{status:'WORKER_UNAUTHORIZED'});
});
test('non-TEST operations and altered payloads are denied without provider IO',async()=>{
 const mock=provider(),h=createReadOnlyTestHandler({...base,fetcher:mock.fetcher});
 for(const op of ['preallocate','send','upload','delete','list']){
  const response=await h(request(op));
  assert.equal(response.status,400);
 }
 const withCompany=new Request('https://fixture.invalid/',{
  method:'POST',headers:{'content-type':'application/json','x-fwh-delivery-secret':KEY},
  body:JSON.stringify({operation:'verify_test_connection',company:'anything'})
 });
 assert.equal((await h(withCompany)).status,400);
 assert.equal(mock.calls.length,0);
});
test('wrong remote identity/wrong Shared Drive/permission failure and Google downtime fail closed',async()=>{
 for(const change of [{email:'wrong@disposable.invalid'},
    {driveId:INTERNAL},{writable:false},{networkFail:true}]){
  const mock=provider(change),r=await createReadOnlyTestHandler({...base,fetcher:mock.fetcher})(request());
  assert.equal(r.status,503);
  const text=await r.text();
  assert.equal(text,'{"status":"TEST_PROVIDER_UNAVAILABLE"}');
  assert.equal(text.includes('SENSITIVE_PRIVATE'),false);
  assert.equal(text.includes(ROOT),false);
 }
});
test('deployed TEST-only entrypoint has no production delivery/database imports',async()=>{
 const s=await readFile(new URL('../../supabase/functions/client-delivery/test-preflight-only.ts',import.meta.url),'utf8');
 assert.ok(s.includes("from './test-preflight-only.mjs'"));
 assert.equal(/from '\.\/handler\.mjs'|service-ledger|worker-runtime|SUPABASE_SERVICE_ROLE_KEY|send|upload-one/.test(s),false);
 assert.ok(s.includes("Deno.env.get('FWH_CLIENT_DELIVERY_ACTIVE')==='true'"));
 assert.ok(s.includes("Deno.env.get('FWH_CLIENT_TEST_PREFLIGHT_ENABLED')==='true'"));
});
