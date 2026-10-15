import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../supabase/functions/client-delivery/handler.mjs';

const SECRET='fixture-worker-secret-1234567890-abcdef';
const ACCESS='fixture-test-google-access-token-123456789';
const ROOT='fixture_test_root_012345678901';
const DRIVE='fixture_test_client_drive_123';
const INTERNAL='fixture_internal_shared_drive_456';
const EMAIL='office@disposable.invalid';
const base=Object.freeze({
 enabled:false,testPreflightEnabled:true,
 workerSecret:SECRET,
 testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
 testRootFolderId:ROOT,expectedDriveId:DRIVE,internalDriveId:INTERNAL,
 testWorkspaceDomain:'disposable.invalid',expectedAccount:EMAIL,
 clientId:'fixture-client-123456789',clientSecret:'fixture-secret-123456789',
 refreshToken:'fixture-refresh-123456789',
 oauthScope:'https://www.googleapis.com/auth/drive'
});
function invoke(payload={operation:'verify_test_connection'},key=SECRET){
 return new Request('https://nonexistent.invalid/functions/v1/client-delivery',{
  method:'POST',headers:{'x-fwh-delivery-secret':key,'content-type':'application/json'},
  body:JSON.stringify(payload)
 });
}
function provider({email=EMAIL,driveId=DRIVE,write=true,failed=false}={}){
 const calls=[];
 const fetcher=async(input,init={})=>{
  const u=new URL(input);
  calls.push({url:u,method:init.method??'GET',headers:init.headers});
  if(failed)throw Error('SECRET_GOOGLE_PROVIDER_ERROR_123');
  if(u.origin==='https://oauth2.googleapis.com'){
   assert.equal(u.pathname,'/token');
   assert.equal(init.method,'POST');
   assert.equal(init.redirect,'error');
   assert.equal(new URLSearchParams(init.body).get('grant_type'),'refresh_token');
   return Response.json({
    token_type:'Bearer',access_token:ACCESS,expires_in:3600,
    scope:'https://www.googleapis.com/auth/drive'
   });
  }
  assert.equal(u.origin,'https://www.googleapis.com');
  assert.equal(init.redirect,'error');
  assert.equal(init.headers.Authorization,'Bearer '+ACCESS);
  assert.equal(init.method??'GET','GET');
  if(u.pathname==='/drive/v3/about')
   return Response.json({user:{emailAddress:email,permissionId:'fixture-provider-id',me:true}});
  if(u.pathname==='/drive/v3/files/'+ROOT)
   return Response.json({id:ROOT,driveId,mimeType:'application/vnd.google-apps.folder',
    trashed:false,capabilities:{canAddChildren:write}});
  throw Error('UNEXPECTED_PROVIDER_PATH');
 };
 return {fetcher,calls};
}
test('authenticated TEST-only hosted preflight refreshes Google and issues only identity/root GETs',async()=>{
 const transport=provider();
 const result=await createDeliveryHandler({...base,fetcher:transport.fetcher})(invoke());
 assert.equal(result.status,200);
 assert.equal(await result.text(),'{"status":"TEST_PROVIDER_VERIFIED_READ_ONLY"}');
 assert.deepEqual(transport.calls.map(c=>c.method),['POST','GET','GET']);
 assert.deepEqual(transport.calls.map(c=>c.url.pathname),
  ['/token','/drive/v3/about','/drive/v3/files/'+ROOT]);
 assert.equal(transport.calls.some(c=>c.url.hostname.endsWith('supabase.co')),false);
 assert.equal(result.headers.get('access-control-allow-origin'),null);
 assert.equal(result.headers.get('cache-control'),'no-store, private');
});
test('unauthenticated/browser calls cannot trigger even a provider read',async()=>{
 const transport=provider();
 const handler=createDeliveryHandler({...base,fetcher:transport.fetcher});
 for(const key of ['', 'sb_publishable_example', SECRET+'x']){
  const r=await handler(invoke(undefined,key));
  assert.equal(r.status,401);
 }
 const get=await handler(new Request('https://nonexistent.invalid/functions/v1/client-delivery'));
 assert.equal(get.status,405);
 assert.equal(transport.calls.length,0);
});
test('TEST preflight requires separate explicit flag and keeps Send/preallocate OFF',async()=>{
 for(const override of [{testPreflightEnabled:false},{enabled:true},
    {testEvidenceClass:''},{testWorkspaceDomain:'wrong.invalid'},
    {internalDriveId:DRIVE},{testRootFolderId:INTERNAL},
    {testRootFolderId:DRIVE},{testRootFolderId:''}]){
  const transport=provider();
  const r=await createDeliveryHandler({...base,...override,fetcher:transport.fetcher})(invoke());
  assert.equal(r.status,503,JSON.stringify(override));
  assert.equal(transport.calls.length,0,JSON.stringify(override));
 }
 const transport=provider();
 const handler=createDeliveryHandler({...base,fetcher:transport.fetcher});
 const preallocate=await handler(invoke({operation:'preallocate'}));
 assert.equal(preallocate.status,503);
 assert.equal((await preallocate.json()).status,'WORKER_NOT_ACTIVATED');
 for(const payload of [{operation:'send'},
  {operation:'verify_test_connection',folderId:ROOT},
  {operation:'verify_test_connection',company:'another-company'},
  {operation:'verify_test_connection',clientId:'override'},
  {operation:'verify_test_connection',action:'enable'},
  {}]){
  const r=await handler(invoke(payload));
  assert.equal(r.status,400);
 }
 assert.equal(transport.calls.length,0);
});
test('wrong Google identity, drive, write permission and uncertain provider transport all fail closed',async()=>{
 for(const config of [{email:'other@disposable.invalid'},
  {driveId:INTERNAL},{write:false},{failed:true}]){
  const transport=provider(config);
  const r=await createDeliveryHandler({...base,fetcher:transport.fetcher})(invoke());
  assert.equal(r.status,503);
  const body=await r.text();
  assert.equal(body,'{"status":"TEST_PROVIDER_UNAVAILABLE"}');
  assert.equal(body.includes('GOOGLE_PROVIDER'),false);
  assert.equal(body.includes(ROOT),false);
  assert.equal(body.includes(SECRET),false);
  assert.equal(transport.calls.some(c=>c.url.hostname.endsWith('supabase.co')),false);
 }
});
test('Deno entry defaults preflight disabled and names all exact TEST configuration inputs',async()=>{
 // This check only audits static host env mapping; it never reads host secrets.
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../../supabase/functions/client-delivery/index.ts',import.meta.url),'utf8');
 for(const name of ['FWH_CLIENT_TEST_PREFLIGHT_ENABLED','FWH_TEST_EVIDENCE_CLASS',
  'FWH_CLIENT_TEST_ROOT_FOLDER_ID','FWH_INTERNAL_SHARED_DRIVE_ID','FWH_TEST_WORKSPACE_DOMAIN']){
   assert.ok(source.includes(name),name);
 }
 assert.ok(source.includes("Deno.env.get('FWH_CLIENT_DELIVERY_ACTIVE')==='true'"));
});
