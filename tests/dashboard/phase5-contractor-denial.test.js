import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {verifyContractorSignerDenied}=require('../../dashboard/phase5-contractor-denial-test.js');

const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=uid(1), admin=uid(2),contractor=uid(3),session=uid(4),
 work=uid(5),run=uid(6),photo=uid(7),version=uid(8);
const host='https://vyocaujuwrivoqynvitm.supabase.co';
function token(user,role,organization=org){
 return ['eyJhbGciOiJub25lIn0',Buffer.from(JSON.stringify({
   sub:user,role:'authenticated',session_id:session,exp:4102444800,
   app_metadata:{role,organization_id:organization}
 })).toString('base64url'),'synthetic-test'].join('.');
}
const adminToken=token(admin,'ADMIN');
const contractorToken=token(contractor,'CONTRACTOR');
const mockPassword='synthetic-only-not-real';
const json=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'Content-Type':'application/json'}});
const opts={method:'POST',headers:{'Content-Type':'application/json'}};

function rig({authStatus=200,authToken=contractorToken,signerStatus=403,
 signerCode='PHOTO_ACCESS_DENIED',logoutStatus=204,wrongAdminWork=false,
 missingPhoto=false,wrongAuthUser=false}={}){
 const requests=[];
 const fetcher=async (url,options={})=>{
   const u=String(url),method=options.method;
   requests.push({url:u,method,authorization:options.headers?.Authorization,
     body:options.body});
   assert.equal(options.credentials,'omit');
   assert.equal(options.redirect,'error');
   assert.equal(options.cache,'no-store');
   if(u.endsWith('/auth/v1/user')){
     const actor=options.headers.Authorization==='Bearer '+adminToken?admin:contractor;
     return json({id:wrongAuthUser&&actor===contractor?uid(99):actor,
       app_metadata:{role:actor===admin?'ADMIN':'CONTRACTOR',
         organization_id:org},is_anonymous:false});
   }
   if(u.includes('/rest/v1/work_orders?')){
     return json([{
       id:work,organization_id:org,wo_number:'TEST-0003-DASHBOARD',
       property_address:wrongAdminWork?'OTHER CLIENT':'TEST ONLY - 300 Test Property Rd'
     }]);
   }
   if(u.includes('/rest/v1/rpc/admin_review_photo_page')){
     assert.equal(options.headers.Authorization,'Bearer '+adminToken);
     return json({work_order_id:work,photos:missingPhoto?[]:[{
       photo_id:photo,run_id:run,transfer_version:version,
       observed_sha256:'a'.repeat(64),decision:'APPROVED'}]});
   }
   if(u.includes('/auth/v1/token?grant_type=password')){
     const input=JSON.parse(options.body);
     assert.equal(input.email,'test-contractor@example.invalid');
     assert.equal(input.password,mockPassword);
     assert.equal(options.headers.Authorization,undefined);
     return authStatus===200?json({access_token:authToken,refresh_token:'synthetic-refresh'}):
       json({error:'invalid_grant'},authStatus);
   }
   if(u.includes('/functions/v1/admin-private-photo')){
     assert.equal(options.headers.Authorization,'Bearer '+authToken);
     assert.deepEqual(JSON.parse(options.body),
       {photo_id:photo,transfer_version:version});
     return json(signerStatus===403?{error:signerCode}:
       {url:'must-never-be-read'},signerStatus);
   }
   if(u.includes('/auth/v1/logout?scope=local')){
     assert.equal(options.headers.Authorization,'Bearer '+authToken);
     return new Response(null,{status:logoutStatus});
   }
   assert.fail('Unexpected live endpoint requested by TEST checker');
 };
 return {requests,config:{fetcher,adminToken,
   email:'test-contractor@example.invalid',password:mockPassword}};
}
test('genuine same-company Contractor bearer receives exact Edge target denial then session is revoked',async()=>{
 const r=rig(),messages=[];
 const result=await verifyContractorSignerDenied({...r.config,
   progress:m=>messages.push(m)});
 assert.deepEqual(result,{
   verified:true,actor:'EXISTING_CONTRACTOR',signer:'PHOTO_ACCESS_DENIED',
   temporary_session:'REVOKED',foreign_organization:'NOT_TESTED',
   photo_bytes_read:false,delivery:'INACTIVE'});
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/token')).length,1);
 assert.equal(r.requests.filter(x=>x.url.includes('/admin-private-photo')).length,1);
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
 assert.equal(r.requests.find(x=>x.url.includes('/admin-private-photo')).authorization,
   'Bearer '+contractorToken);
 assert.equal(r.requests.some(x=>x.url.includes('/storage/v1/object/')),false);
 assert.equal(r.requests.some(x=>x.url.includes('send')||x.url.includes('upload')),false);
 assert.equal(JSON.stringify(result).includes(contractorToken),false);
 assert.equal(JSON.stringify(result).includes(mockPassword),false);
 assert.equal(JSON.stringify(messages).includes(mockPassword),false);
});
test('never signs in Contractor until approved TEST fixture resolved by current Admin',async()=>{
 for(const options of [{wrongAdminWork:true},{missingPhoto:true}]){
   const r=rig(options);
   await assert.rejects(()=>verifyContractorSignerDenied(r.config),
     e=>e.code==='TEST_FIXTURE_NOT_AUTHORIZED');
   assert.equal(r.requests.some(x=>x.url.includes('/auth/v1/token')),false);
   assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
 }
});
test('password grant authentication failure does not count as signer authorization denial',async()=>{
 const r=rig({authStatus:400});
 await assert.rejects(()=>verifyContractorSignerDenied(r.config),
   e=>e.code==='CONTRACTOR_SIGN_IN_FAILED');
 assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
});
test('an Admin or account from another organization is not accepted as test Contractor',async()=>{
 for(const identity of [token(admin,'ADMIN'),token(contractor,'CONTRACTOR',uid(30))]){
   const r=rig({authToken:identity});
   await assert.rejects(()=>verifyContractorSignerDenied(r.config),
     e=>['TEST_SESSION_UNVERIFIED','NOT_AN_EXISTING_TEST_CONTRACTOR'].includes(e.code));
   assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
   assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
 }
});
test('a mismatched current Auth user fails before signer invocation and revokes session',async()=>{
 const r=rig({wrongAuthUser:true});
 await assert.rejects(()=>verifyContractorSignerDenied(r.config),
   e=>e.code==='TEST_SESSION_UNVERIFIED');
 assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
});
test('only exact PHOTO_ACCESS_DENIED HTTP 403 qualifies, never 401/404 or unrelated 403',async()=>{
 for(const options of [
   {signerStatus:401},{signerStatus:404},
   {signerStatus:403,signerCode:'ORIGIN_DENIED'},
   {signerStatus:503},{signerStatus:400}
 ]){
   const r=rig(options);
   await assert.rejects(()=>verifyContractorSignerDenied(r.config),
     e=>e.code==='CONTRACTOR_DENIAL_UNVERIFIED');
   assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
 }
});
test('HTTP 200 from Contractor signer is exposure warning and cannot return PASS',async()=>{
 const r=rig({signerStatus:200});
 await assert.rejects(()=>verifyContractorSignerDenied(r.config),
   e=>e.code==='CONTRACTOR_SIGNED_URL_EXPOSED');
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
 assert.equal(r.requests.some(x=>x.url.includes('/storage/v1/object/')),false);
});
test('logout failure makes otherwise denied signer result BLOCKED, not PASS',async()=>{
 const r=rig({logoutStatus:500});
 await assert.rejects(()=>verifyContractorSignerDenied(r.config),
   e=>e.code==='CONTRACTOR_TEST_SIGNOUT_UNVERIFIED');
});
test('never claims a foreign-company test, repeats photo-byte test or alters working Admin session',async()=>{
 const r=rig(),tokenBefore=r.config.adminToken;
 const result=await verifyContractorSignerDenied(r.config);
 assert.equal(r.config.adminToken,tokenBefore);
 assert.equal(result.foreign_organization,'NOT_TESTED');
 assert.equal(r.requests.filter(x=>x.url.includes('/admin-private-photo')).length,1);
 assert.equal(r.requests.some(x=>x.method==='HEAD'),false);
 assert.equal(r.requests.some(x=>x.url.includes('/object/sign/')),false);
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/user')).length,2);
});
