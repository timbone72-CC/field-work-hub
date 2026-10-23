// Hermetic bound for the operator-authorized two-photo isolated TEST Send.
// Does not call Google, Supabase or create an actual delivery/worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../supabase/functions/client-delivery/handler.mjs';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const pkg=uuid(1),dest=uuid(2),other=uuid(3),worker=uuid(4);
const root='fwh_disposable_root_0123456789';
const shared='fwh_disposable_shared_drive_0123456789';
const internal='fwh_internal_shared_drive_0123456789';
const secret='private-disposable-test-worker-secret-0123456789';
const credential='service.secret.jwt';
const scope='https://www.googleapis.com/auth/drive';
const photo=[uuid(10),uuid(11)];
const approved={
 claimed:true,package_id:pkg,destination_id:dest,generation:1,
 approved_sha256:'a'.repeat(64),
 manifest:{package_id:pkg,destination_id:dest,destination_root:root,
 selected_photos:photo.map(photo_id=>({photo_id}))}
};
const base={
 enabled:true,testPreflightEnabled:false,testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
 testReleasePackageId:pkg,testReleaseDestinationId:dest,
 testRootFolderId:root,internalDriveId:internal,
 testWorkspaceDomain:'disposable.invalid',
 workerSecret:secret,expectedAccount:'worker@disposable.invalid',
 expectedDriveId:shared,
 clientId:'test-oauth-client-id',clientSecret:'test-oauth-client-secret',
 refreshToken:'test-oauth-refresh-token',oauthScope:scope,
 supabaseUrl:'https://vyocaujuwrivoqynvitm.supabase.co',
 serviceRoleJwt:credential,sessionVaultKey:'A'.repeat(43),
 makeWorkerId:()=>worker
};
function req(payload,cred=secret){
 return new Request('https://fixture.invalid/worker',{
  method:'POST',headers:{
   'content-type':'application/json','x-fwh-delivery-secret':cred
  },body:JSON.stringify(payload)
 });
}
function simulate({claim={claimed:false},active={state:'NONE'},missingExactRpc=false}={}){
 const calls=[];
 const fetcher=async(url,options={})=>{
  const u=new URL(url),method=options.method??'GET';
  calls.push({path:u.pathname,method,origin:u.origin});
  if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token'){
   return Response.json({access_token:'disposable_access_token_0123456789',
    token_type:'Bearer',expires_in:3600,scope});
  }
  if(u.origin==='https://vyocaujuwrivoqynvitm.supabase.co'&&method==='POST'
     &&u.pathname.startsWith('/rest/v1/rpc/')){
   switch(u.pathname.slice('/rest/v1/rpc/'.length)){
    case 'service_acquire_delivery_dispatch': return Response.json({acquired:true});
    case 'service_release_delivery_dispatch': return Response.json({released:true});
    case 'service_claim_delivery': throw Error('BROAD_CLAIM_MUST_NEVER_BE_CALLED');
    case 'service_claim_exact_test_delivery': {
      const body=JSON.parse(options.body);
      assert.deepEqual(body,{p_worker:worker,p_package:pkg,p_destination:dest,p_root:root});
      return missingExactRpc?Response.json({code:'PGRST202'},{status:404}):Response.json(claim);
    }
    case 'service_read_active_delivery_lease':return Response.json(active);
    default:throw Error('UNEXPECTED_SQL_OPERATION:'+u.pathname);
   }
  }
  throw Error('TEST_UNAUTHORIZED_REMOTE_PROVIDER_ACCESS:'+u.pathname);
 };
 return {calls,fetcher};
}
test('active TEST worker denies missing pin, wrong evidence class and overlapping read-only mode before any I/O',async()=>{
 const failures=[
  {testReleasePackageId:''},{testReleaseDestinationId:''},
  {testEvidenceClass:''},
  {testRootFolderId:shared},{testRootFolderId:internal},
  {expectedDriveId:internal},{testWorkspaceDomain:'other.invalid'}
 ];
 for(const x of failures){
  const mock=simulate();
  const result=await createDeliveryHandler({...base,...x,fetcher:mock.fetcher})(req({operation:'preallocate'}));
  assert.equal(result.status,503,JSON.stringify(x));
  assert.deepEqual(mock.calls,[],JSON.stringify(x));
 }
 const conflict=simulate();
 assert.equal((await createDeliveryHandler({...base,testPreflightEnabled:true,
  fetcher:conflict.fetcher})(req({operation:'preallocate'}))).status,503);
 assert.deepEqual(conflict.calls,[]);
});
test('active isolated TEST release denies explicit wrong package and worker key before permit/Google access',async()=>{
 const mock=simulate();
 const handler=createDeliveryHandler({...base,fetcher:mock.fetcher});
 const response=await handler(req({operation:'transfer_one_chunk',
   package_id:other,worker_id:worker,generation:1,plan_id:uuid(5)}));
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{status:'TEST_RELEASE_SCOPE_DENIED'});
 assert.equal((await handler(req({operation:'preallocate'},'wrong'))).status,401);
 assert.deepEqual(mock.calls,[]);
});
test('empty original queue releases the singleton permit; no provider files created',async()=>{
 const mock=simulate();
 const r=await createDeliveryHandler({...base,fetcher:mock.fetcher})(req({operation:'preallocate'}));
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{status:'NO_ELIGIBLE_PACKAGES'});
 assert.deepEqual(mock.calls.map(c=>c.path),[
  '/rest/v1/rpc/service_acquire_delivery_dispatch',
  '/token','/rest/v1/rpc/service_claim_exact_test_delivery',
  '/rest/v1/rpc/service_release_delivery_dispatch'
 ]);
 assert.equal(mock.calls.some(c=>c.origin==='https://www.googleapis.com'),false);
});
test('different claimed package/destination or photo count cannot reach Google and retains crash-safe permit',async()=>{
 for(const claim of [
  {...approved,package_id:other},
  {...approved,destination_id:other},
  {...approved,manifest:{...approved.manifest,destination_root:internal}},
  {...approved,manifest:{...approved.manifest,selected_photos:[approved.manifest.selected_photos[0]]}}
 ]){
  const mock=simulate({claim});
  const r=await createDeliveryHandler({...base,fetcher:mock.fetcher})(req({operation:'preallocate'}));
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{status:'TRUSTED_PROVIDER_UNAVAILABLE'});
  assert.deepEqual(mock.calls.map(c=>c.path),[
   '/rest/v1/rpc/service_acquire_delivery_dispatch',
   '/token','/rest/v1/rpc/service_claim_exact_test_delivery'
  ]);
 }
});
test('missing exact-package SQL RPC refuses broad claim without Google write',async()=>{
 const mock=simulate({missingExactRpc:true});
 const r=await createDeliveryHandler({...base,fetcher:mock.fetcher})(
   req({operation:'preallocate'}));
 assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{status:'TRUSTED_PROVIDER_UNAVAILABLE'});
 assert.deepEqual(mock.calls.map(x=>x.path),[
  '/rest/v1/rpc/service_acquire_delivery_dispatch',
  '/token','/rest/v1/rpc/service_claim_exact_test_delivery'
 ]);
 assert.equal(mock.calls.some(x=>x.path==='/rest/v1/rpc/service_claim_delivery'),false);
 assert.equal(mock.calls.some(x=>x.origin==='https://www.googleapis.com'),false);
});
test('restart with foreign active original lease stops before any provider write or new identity',async()=>{
 const mismatch={state:'ACTIVE',package_id:other,destination_id:dest,
  worker_id:worker,generation:1,manifest:approved.manifest,
  approved_sha256:approved.approved_sha256};
 const mock=simulate({active:mismatch});
 const r=await createDeliveryHandler({...base,fetcher:mock.fetcher})(req({operation:'advance_once'}));
 assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{status:'TRUSTED_PROVIDER_UNAVAILABLE'});
 assert.deepEqual(mock.calls.map(c=>c.path),[
  '/rest/v1/rpc/service_acquire_delivery_dispatch',
  '/rest/v1/rpc/service_read_active_delivery_lease'
 ]);
});
