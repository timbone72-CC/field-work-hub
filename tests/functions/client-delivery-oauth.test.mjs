import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceTokenProvider,OAuthUnavailable}
  from '../../supabase/functions/client-delivery/workspace-oauth.mjs';
const scope='https://www.googleapis.com/auth/drive.file';
const conf={clientId:'disposable-client-id-12345',
 clientSecret:'disposable-secret-12345',refreshToken:'disposable-refresh-12345',requiredScope:scope};
const token={access_token:'disposable-access-token-12345',token_type:'Bearer',expires_in:3600,scope};
const json=(value,status=200)=>new Response(JSON.stringify(value),
 {status,headers:{'Content-Type':'application/json'}});
const expected=(code)=>e=>e instanceof OAuthUnavailable&&e.code===code;
test('Workspace credentials fail closed when any required backend value is absent',()=>{
 for(const key of ['clientId','clientSecret','refreshToken','requiredScope']){
  assert.throws(()=>createWorkspaceTokenProvider({...conf,[key]:''}),
   expected('BACKEND_OAUTH_NOT_CONFIGURED'));
 }
});
test('only fixed token endpoint receives backend secrets, never returns refresh token',async()=>{
 const requests=[];
 const refresh=createWorkspaceTokenProvider({...conf,fetcher:async(url,init)=>{
  requests.push({url,init});return json(token);
 }});
 assert.deepEqual(await refresh(),{accessToken:token.access_token,expiresInSeconds:3600});
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://oauth2.googleapis.com/token');
 assert.equal(requests[0].init.redirect,'error');
 const form=new URLSearchParams(requests[0].init.body);
 assert.equal(form.get('refresh_token'),conf.refreshToken);
 assert.equal(form.get('grant_type'),'refresh_token');
 assert.ok(!JSON.stringify(await refresh()).includes('disposable-refresh'));
});
test('unauthorized refresh means intervention, never logged raw body or fake success',async()=>{
 for(const s of [400,401]) {
  const refresh=createWorkspaceTokenProvider({...conf,fetcher:()=>json({
   error:'invalid_grant',secret:'DO_NOT_LEAK_PRIVATE_TOKEN'},s)});
  await assert.rejects(refresh,expected('WORKSPACE_AUTHORIZATION_REQUIRED'));
 }
});
test('wrong scope, incomplete token and unexpected errors never authorize Drive operations',async()=>{
 for(const bad of [{...token,scope:'https://www.googleapis.com/auth/calendar'},
  {...token,access_token:'short'}, {...token,token_type:'Basic'},
  {...token,expires_in:5},{...token,expires_in:999999},
  {...token,scope:99}]){
   const refresh=createWorkspaceTokenProvider({...conf,fetcher:()=>json(bad)});
   await assert.rejects(refresh);
 }
 for(const mock of [()=>{throw Error('offline secret');},()=>json({},503)]){
  const refresh=createWorkspaceTokenProvider({...conf,fetcher:mock});
  await assert.rejects(refresh,expected('OAUTH_OUTCOME_UNCERTAIN'));
 }
});
