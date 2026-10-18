import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyPhase5WorkspaceProvider,ProviderPreflightBlocked}
 from '../../ci/verify_phase5_workspace_provider.mjs';

const email='worker@disposable.invalid',scope='https://www.googleapis.com/auth/drive.file';
const internal='internal_'+'i'.repeat(20),clientDrive='client_'+'d'.repeat(20);
const root='folder_'+'r'.repeat(20);
const token='synthetic-test-access-token-0123456789';
const env={
 FWH_TEST_EVIDENCE_CLASS:'DISPOSABLE_FWH_TEST_ONLY',
 FWH_TEST_WORKSPACE_EMAIL:email,FWH_TEST_WORKSPACE_DOMAIN:'disposable.invalid',
 FWH_TEST_INTERNAL_SHARED_DRIVE_ID:internal,
 FWH_TEST_CLIENT_SHARED_DRIVE_ID:clientDrive,
 FWH_TEST_CLIENT_ROOT_FOLDER_ID:root,
 FWH_TEST_WORKSPACE_CLIENT_ID:'synthetic-client-id-00001',
 FWH_TEST_WORKSPACE_CLIENT_SECRET:'synthetic-client-secret-00001',
 FWH_TEST_WORKSPACE_REFRESH_TOKEN:'synthetic-refresh-token-00001',
 FWH_TEST_WORKSPACE_SCOPE:scope
};
function rig({wrongAccount=false,wrongDrive=false,unwritable=false}={}){
 const events=[];
 const fetcher=async(url,options)=>{
  const u=new URL(url);
  events.push({origin:u.origin,path:u.pathname,method:options.method||'GET'});
  if(u.origin==='https://oauth2.googleapis.com'){
   assert.equal(u.pathname,'/token');assert.equal(options.method,'POST');
   const form=new URLSearchParams(options.body);
   assert.equal(form.get('client_id'),env.FWH_TEST_WORKSPACE_CLIENT_ID);
   assert.equal(form.get('refresh_token'),env.FWH_TEST_WORKSPACE_REFRESH_TOKEN);
   return Response.json({access_token:token,token_type:'Bearer',
    expires_in:3600,scope});
  }
  assert.equal(u.origin,'https://www.googleapis.com');
  assert.equal(options.method,undefined,'Drive preflight must be GET-only');
  assert.equal(options.headers.Authorization,'Bearer '+token);
  if(u.pathname==='/drive/v3/about')
   return Response.json({user:{emailAddress:wrongAccount?
     'other@disposable.invalid':email,me:true,permissionId:'perm_example'}});
  if(u.pathname==='/drive/v3/files/'+root)
   return Response.json({id:root,driveId:wrongDrive?internal:clientDrive,
    mimeType:'application/vnd.google-apps.folder',trashed:false,
    capabilities:{canAddChildren:!unwritable}});
  throw Error('NO_OTHER_PROVIDER_METHOD');
 };
 return {events,fetcher};
}
test('only disposable test mode and explicit distinct Workspace/client Drive may proceed',async()=>{
 const scenarios=[
  {FWH_TEST_EVIDENCE_CLASS:'PRODUCTION'},
  {FWH_TEST_WORKSPACE_EMAIL:'someone@gmail.com'},
  {FWH_TEST_CLIENT_SHARED_DRIVE_ID:internal},
  {FWH_TEST_CLIENT_ROOT_FOLDER_ID:internal},
  {FWH_TEST_CLIENT_ROOT_FOLDER_ID:clientDrive}
 ];
 for(const changes of scenarios){
  const r=rig();
  await assert.rejects(()=>verifyPhase5WorkspaceProvider({
   env:{...env,...changes},fetcher:r.fetcher
  }),error=>error instanceof ProviderPreflightBlocked);
  assert.deepEqual(r.events,[],'Invalid TEST identity never asks Google for a token');
 }
});
test('valid backend OAuth and independent Drive GET prove the exact separate client root without a write',async()=>{
 const r=rig();
 const result=await verifyPhase5WorkspaceProvider({env,fetcher:r.fetcher});
 assert.deepEqual(result,{test_only:true,account_verified:true,
  client_root_writable:true,separate_from_internal_drive:true,
  provider_writes_performed:false,worker_activated:false});
 assert.deepEqual(r.events,[
  {origin:'https://oauth2.googleapis.com',path:'/token',method:'POST'},
  {origin:'https://www.googleapis.com',path:'/drive/v3/about',method:'GET'},
  {origin:'https://www.googleapis.com',path:'/drive/v3/files/'+root,method:'GET'}
 ]);
 const exposed=JSON.stringify(result);
 assert.ok(!exposed.includes(token)&&!exposed.includes(email)
  &&!exposed.includes(root)&&!exposed.includes(env.FWH_TEST_WORKSPACE_REFRESH_TOKEN));
});
test('foreign provider identity, wrong Drive or read-only folder block TEST delivery preflight',async()=>{
 for(const caseName of ['wrongAccount','wrongDrive','unwritable']){
  const r=rig({[caseName]:true});
  await assert.rejects(()=>verifyPhase5WorkspaceProvider({env,fetcher:r.fetcher}));
  assert.ok(!r.events.some(event=>event.origin==='https://www.googleapis.com'&&event.method!=='GET'));
 }
});
test('missing refresh credential never reaches the provider',async()=>{
 const r=rig();
 await assert.rejects(()=>verifyPhase5WorkspaceProvider({
  env:{...env,FWH_TEST_WORKSPACE_REFRESH_TOKEN:''},fetcher:r.fetcher
 }));
 assert.deepEqual(r.events,[]);
});

test('operator CLI refusal prints only a fixed code, never env credentials',()=>{
 const script=fileURLToPath(new URL('../../ci/verify_phase5_workspace_provider.mjs',import.meta.url));
 const child=spawnSync(process.execPath,[script],{
  env:{...process.env,...env,FWH_TEST_EVIDENCE_CLASS:'NOT_TEST'},
  encoding:'utf8',timeout:5000
 });
 assert.equal(child.status,1);
 assert.equal(child.stdout,'');
 assert.equal(child.stderr.trim(),'BLOCKED: TEST_ONLY_EVIDENCE_REQUIRED');
 assert.ok(!child.stderr.includes(env.FWH_TEST_WORKSPACE_CLIENT_SECRET)
  &&!child.stderr.includes(env.FWH_TEST_WORKSPACE_REFRESH_TOKEN));
});
