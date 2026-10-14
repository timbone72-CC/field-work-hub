import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {
 REDIRECT_URI,WorkspaceBootstrapBlocked,validateBootstrapConfiguration,
 makeAuthorizationUrl,exchangeAndVerify
} from '../../ci/authorize_phase5_workspace_provider.mjs';

const clientId='860765799656-synthetic-test.apps.googleusercontent.com';
const web={web:{project_id:'field-work-hub',client_id:clientId,
 client_secret:'synthetic-not-a-real-secret',
 auth_uri:'https://accounts.google.com/o/oauth2/auth',
 token_uri:'https://oauth2.googleapis.com/token'}};
const drive='disposable-client-drive-123',internal='disposable-internal-drive-123';
const root='disposable-client-root-123',email='example@disposable.invalid';
const env={
 FWH_TEST_EVIDENCE_CLASS:'DISPOSABLE_FWH_TEST_ONLY',
 FWH_TEST_WORKSPACE_EMAIL:email,FWH_TEST_WORKSPACE_DOMAIN:'disposable.invalid',
 FWH_TEST_INTERNAL_SHARED_DRIVE_ID:internal,
 FWH_TEST_CLIENT_SHARED_DRIVE_ID:drive,
 FWH_TEST_CLIENT_ROOT_FOLDER_ID:root,
 FWH_TEST_WORKSPACE_SCOPE:'https://www.googleapis.com/auth/drive',
 FWH_TEST_CREDENTIALS_OUT:homedir()+'/.config/field-work-hub/only-a-test-fwh-private-oauth.json'
};
const verifier='v'.repeat(64);
const state='s'.repeat(48);
test('OAuth URL binds signed-in account, local exact callback, offline Drive scope, state and S256 challenge',()=>{
 const url=new URL(makeAuthorizationUrl({clientId,email,state,verifier}));
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.pathname,'/o/oauth2/v2/auth');
 assert.equal(url.searchParams.get('client_id'),clientId);
 assert.equal(url.searchParams.get('redirect_uri'),REDIRECT_URI);
 assert.equal(url.searchParams.get('scope'),env.FWH_TEST_WORKSPACE_SCOPE);
 assert.equal(url.searchParams.get('access_type'),'offline');
 assert.equal(url.searchParams.get('prompt'),'consent');
 assert.equal(url.searchParams.get('login_hint'),email);
 assert.equal(url.searchParams.get('state'),state);
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.ok(url.searchParams.get('code_challenge')?.length>40);
 assert.equal(url.searchParams.has('client_secret'),false);
});
test('missing TEST marker, exact Workspace, distinct TEST client drive or valid client JSON fails closed',()=>{
 const changes=[
  {FWH_TEST_EVIDENCE_CLASS:'PRODUCTION'},
  {FWH_TEST_WORKSPACE_EMAIL:'another@gmail.com'},
  {FWH_TEST_CLIENT_SHARED_DRIVE_ID:internal},
  {FWH_TEST_CLIENT_ROOT_FOLDER_ID:drive},
  {FWH_TEST_WORKSPACE_SCOPE:'https://www.googleapis.com/auth/drive.file'},
  {FWH_TEST_CREDENTIALS_OUT:'credentials.json'}
 ];
 for(const change of changes)
  assert.throws(()=>validateBootstrapConfiguration(web,{...env,...change}),
   WorkspaceBootstrapBlocked);
 for(const candidate of [{installed:web.web},{web:{...web.web,project_id:'other-project'}},
  {web:{...web.web,client_secret:''}}])
   assert.throws(()=>validateBootstrapConfiguration(candidate,env),WorkspaceBootstrapBlocked);
});
test('fresh authorization code verifies provider email and exactly separate writable Drive root before returning private-only refresh config',async()=>{
 const events=[],accessToken='synthetic-access-token-0123456789';
 const refreshToken='synthetic-refresh-token-0123456789';
 const fetcher=async(url,options={})=>{
  const u=new URL(url);events.push([u.origin,u.pathname,options.method||'GET']);
  if(u.pathname==='/token'){
   const params=new URLSearchParams(options.body);
   assert.equal(options.redirect,'error');
   assert.equal(params.get('client_secret'),web.web.client_secret);
   assert.equal(params.get('redirect_uri'),REDIRECT_URI);
   assert.ok(params.has('code_verifier')||params.get('grant_type')==='refresh_token');
   return Response.json({access_token:accessToken,refresh_token:refreshToken,
    token_type:'Bearer',scope:env.FWH_TEST_WORKSPACE_SCOPE,expires_in:3600});
  }
  assert.equal(options.headers.Authorization,'Bearer '+accessToken);
  assert.equal(options.method,undefined,'Only read Drive GETs are authorized');
  if(u.pathname==='/drive/v3/about')
   return Response.json({user:{emailAddress:email,me:true,permissionId:'permission-123'}});
  if(u.pathname==='/drive/v3/files/'+root)
   return Response.json({id:root,driveId:drive,trashed:false,
    mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});
  throw Error('UNEXPECTED_NETWORK_REQUEST');
 };
 const config=validateBootstrapConfiguration(web,env);
 const value=await exchangeAndVerify({code:'synthetic-auth-code-0123456789',
  verifier,config,fetcher});
 assert.equal(value.FWH_TEST_WORKSPACE_REFRESH_TOKEN,refreshToken);
 assert.equal(value.FWH_TEST_WORKSPACE_CLIENT_ID,clientId);
 assert.equal(value.FWH_TEST_CLIENT_SHARED_DRIVE_ID,drive);
 assert.deepEqual(events,[
  ['https://oauth2.googleapis.com','/token','POST'],
  ['https://www.googleapis.com','/drive/v3/about','GET'],
  ['https://www.googleapis.com','/drive/v3/files/'+root,'GET'],
  ['https://oauth2.googleapis.com','/token','POST']
 ]);
});
test('wrong Workspace identity and foreign TEST Drive reject authorization before refresh credentials can be retained',async()=>{
 for(const mismatch of ['email','drive','write']){
  const cfg=validateBootstrapConfiguration(web,env);
  const fetcher=async(url)=>{
   const path=new URL(url).pathname;
   if(path==='/token')return Response.json({access_token:'synthetic-access-token-0123456789',
    refresh_token:'synthetic-refresh-token-0123456789',token_type:'Bearer',
    expires_in:3600,scope:env.FWH_TEST_WORKSPACE_SCOPE});
   if(path==='/drive/v3/about')return Response.json({user:{
    emailAddress:mismatch==='email'?'unauthorized@disposable.invalid':email,
    me:true,permissionId:'permission-123'}});
   if(path==='/drive/v3/files/'+root)return Response.json({
    id:root,driveId:mismatch==='drive'?internal:drive,trashed:false,
    mimeType:'application/vnd.google-apps.folder',
    capabilities:{canAddChildren:mismatch!=='write'}});
   throw Error();
  };
  await assert.rejects(()=>exchangeAndVerify({code:'synthetic-auth-code-0123456789',
   verifier,config:cfg,fetcher}),WorkspaceBootstrapBlocked);
 }
});
