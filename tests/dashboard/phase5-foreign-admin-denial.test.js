import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {verifyForeignAdminDenied}=require('../../dashboard/phase5-foreign-admin-denial-test.js');

const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=uid(1),otherOrg=uid(30),admin=uid(2),otherAdmin=uid(3),
 session=uid(4),work=uid(5),run=uid(6),photo=uid(7),version=uid(8);
const host='https://vyocaujuwrivoqynvitm.supabase.co';
const temporaryPassword='test-fake-password-not-real';
function jwt(user,organization,role='ADMIN'){
 return ['eyJhbGciOiJub25lIn0',Buffer.from(JSON.stringify({
   sub:user,role:'authenticated',session_id:session,exp:4102444800,
   app_metadata:{role,organization_id:organization}
 })).toString('base64url'),'fake-test'].join('.');
}
const originalToken=jwt(admin,org),foreignToken=jwt(otherAdmin,otherOrg);
const json=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'Content-Type':'application/json'}});
function rig({originalWorkWrong=false,photoMissing=false,authStatus=200,
 signInToken=foreignToken,userMismatch=false,signerStatus=403,
 signerCode='PHOTO_ACCESS_DENIED',exactExposure=false,
 broadExposure=false,logoutStatus=204,exactStatus=200,listStatus=200}={}){
 const requests=[];
 const fetcher=async (url,opts={})=>{
   const u=String(url);
   requests.push({url:u,method:opts.method,body:opts.body,
     authorization:opts.headers?.Authorization,credentials:opts.credentials});
   assert.equal(opts.credentials,'omit');
   assert.equal(opts.redirect,'error');
   assert.equal(opts.cache,'no-store');
   if(u.endsWith('/auth/v1/user')){
     const original=opts.headers.Authorization==='Bearer '+originalToken;
     return json({id:userMismatch&&!original?uid(99):original?admin:otherAdmin,
       is_anonymous:false,app_metadata:{role:'ADMIN',
         organization_id:original?org:otherOrg}});
   }
   if(u.includes('/rest/v1/work_orders?')&&u.includes('wo_number=eq.TEST-0003-DASHBOARD')){
     assert.equal(opts.headers.Authorization,'Bearer '+originalToken);
     return json([{id:work,organization_id:org,
       wo_number:'TEST-0003-DASHBOARD',
       property_address:originalWorkWrong?'REAL JOB':'TEST ONLY - 300 Test Property Rd'}]);
   }
   if(u.includes('/rest/v1/rpc/admin_review_photo_page')){
     assert.equal(opts.headers.Authorization,'Bearer '+originalToken);
     return json({work_order_id:work,photos:photoMissing?[]:[{
       photo_id:photo,run_id:run,transfer_version:version,
       observed_sha256:'a'.repeat(64),decision:'APPROVED'}]});
   }
   if(u.includes('/auth/v1/token?grant_type=password')){
     assert.equal(opts.headers.Authorization,undefined);
     assert.deepEqual(JSON.parse(opts.body),{
       email:'separate-test@example.invalid',password:temporaryPassword});
     return authStatus===200?json({access_token:signInToken,
       refresh_token:'synthetic-not-stored'}):json({error:'invalid_grant'},authStatus);
   }
   if(u.includes('/rest/v1/work_orders?')&&u.includes('id=eq.')){
     assert.equal(opts.headers.Authorization,'Bearer '+signInToken);
     return json(exactExposure?[{id:work,organization_id:org,
       wo_number:'TEST-0003-DASHBOARD'}]:[],exactStatus);
   }
   if(u.includes('/rest/v1/work_orders?')&&u.includes('limit=25')){
     assert.equal(opts.headers.Authorization,'Bearer '+signInToken);
     return json(broadExposure?[{id:work,organization_id:org}]:
       [{id:uid(31),organization_id:otherOrg}],listStatus);
   }
   if(u.includes('/functions/v1/admin-private-photo')){
     assert.equal(opts.headers.Authorization,'Bearer '+signInToken);
     assert.deepEqual(JSON.parse(opts.body),{photo_id:photo,transfer_version:version});
     return signerStatus===403?json({error:signerCode},403):
       json(signerStatus===200?{url:'must-not-return-a-signed-url'}:
         {error:'unverified'},signerStatus);
   }
   if(u.includes('/auth/v1/logout?scope=local')){
     assert.equal(opts.headers.Authorization,'Bearer '+signInToken);
     return new Response(null,{status:logoutStatus});
   }
   assert.fail('Unexpected TEST endpoint: '+u);
 };
 return {requests,config:{fetcher,adminToken:originalToken,
   email:'separate-test@example.invalid',password:temporaryPassword}};
}
test('separate-company Admin real-bearer gate requires exact and paged RLS isolation, signer 403 and revoked session',async()=>{
 const r=rig(),progress=[];
 const result=await verifyForeignAdminDenied({...r.config,
   progress:m=>progress.push(m)});
 assert.deepEqual(result,{
   verified:true,foreign_company:'SEPARATE_ADMIN',exact_work_order:'HIDDEN',
   scoped_list:'ISOLATED',signer:'PHOTO_ACCESS_DENIED',
   temporary_session:'REVOKED',photo_bytes_read:false,delivery:'INACTIVE'});
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/token')).length,1);
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
 assert.equal(r.requests.filter(x=>x.url.includes('/admin-private-photo')).length,1);
 assert.equal(r.requests.find(x=>x.url.includes('/admin-private-photo')).authorization,
   'Bearer '+foreignToken);
 assert.equal(r.requests.some(x=>x.url.includes('/storage/v1/object')),false);
 assert.equal(r.requests.some(x=>/send|upload|delete|activate/.test(x.url)),false);
 for(const word of [temporaryPassword,foreignToken,originalToken,photo,work]){
   assert.equal(JSON.stringify(result).includes(word),false);
   assert.equal(JSON.stringify(progress).includes(word),false);
 }
});
test('never requests a second company login until original immutable TEST photo is confirmed',async()=>{
 for(const options of [{originalWorkWrong:true},{photoMissing:true}]){
   const r=rig(options);
   await assert.rejects(()=>verifyForeignAdminDenied(r.config),
     e=>e.code==='ORIGINAL_TEST_FIXTURE_UNVERIFIED');
   assert.equal(r.requests.some(x=>x.url.includes('/auth/v1/token')),false);
   assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
 }
});
test('an invalid second-company password cannot count as forbidden-data denial',async()=>{
 const r=rig({authStatus:400});
 await assert.rejects(()=>verifyForeignAdminDenied(r.config),
   e=>e.code==='SECOND_ADMIN_SIGN_IN_FAILED');
 assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
});
test('same-company Admin or Contractor token cannot substitute for second-company Admin',async()=>{
 for(const identity of [jwt(otherAdmin,org),jwt(otherAdmin,otherOrg,'CONTRACTOR')]){
   const r=rig({signInToken:identity});
   await assert.rejects(()=>verifyForeignAdminDenied(r.config),
     e=>['NOT_SEPARATE_TEST_COMPANY_ADMIN','TEST_SESSION_UNVERIFIED'].includes(e.code));
   assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
   assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
 }
});
test('mismatched Auth user cannot turn a forged JWT payload into authorization',async()=>{
 const r=rig({userMismatch:true});
 await assert.rejects(()=>verifyForeignAdminDenied(r.config),
   e=>e.code==='TEST_SESSION_UNVERIFIED');
 assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
});
test('exact cross-company work-order exposure stops before any signer request',async()=>{
 const r=rig({exactExposure:true});
 await assert.rejects(()=>verifyForeignAdminDenied(r.config),
   e=>e.code==='FOREIGN_WORK_ORDER_EXPOSED');
 assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
});
test('broad list with any original-company work is an exposure, even when exact lookup was hidden',async()=>{
 const r=rig({broadExposure:true});
 await assert.rejects(()=>verifyForeignAdminDenied(r.config),
   e=>e.code==='FOREIGN_WORK_LIST_EXPOSED');
 assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
});
test('failed or unauthorized work-order reads never falsely count as verified RLS isolation',async()=>{
 for(const options of [{exactStatus:403},{exactStatus:503},{listStatus:401},{listStatus:500}]){
   const r=rig(options);
   await assert.rejects(()=>verifyForeignAdminDenied(r.config),
     e=>['FOREIGN_WORK_ORDER_CHECK_UNVERIFIED',
       'FOREIGN_WORK_LIST_CHECK_UNVERIFIED'].includes(e.code));
   assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
 }
});
test('only exact PHOTO_ACCESS_DENIED at HTTP 403 is accepted, not 401/404/503/unrelated errors',async()=>{
 for(const options of [
   {signerStatus:401},{signerStatus:404},{signerStatus:503},
   {signerStatus:403,signerCode:'ORIGIN_DENIED'}
 ]){
   const r=rig(options);
   await assert.rejects(()=>verifyForeignAdminDenied(r.config),
     e=>e.code==='FOREIGN_SIGNER_DENIAL_UNVERIFIED');
   assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
 }
});
test('a 200 signed URL is an exposure warning and never triggers a signed photo GET',async()=>{
 const r=rig({signerStatus:200});
 await assert.rejects(()=>verifyForeignAdminDenied(r.config),
   e=>e.code==='FOREIGN_SIGNED_URL_EXPOSED');
 assert.equal(r.requests.some(x=>x.url.includes('/object/sign/')),false);
 assert.equal(r.requests.filter(x=>x.url.includes('/auth/v1/logout')).length,1);
});
test('temporary session logout failure must block PASS, leaving original Admin session untouched',async()=>{
 const r=rig({logoutStatus:500});
 await assert.rejects(()=>verifyForeignAdminDenied(r.config),
   e=>e.code==='SECOND_ADMIN_SIGNOUT_UNVERIFIED');
 assert.equal(r.config.adminToken,originalToken);
 assert.equal(r.requests.some(x=>x.url.includes('/object/sign/')),false);
});
