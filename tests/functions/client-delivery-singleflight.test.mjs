// Existing Edge worker single-flight across independent HTTP invocations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../supabase/functions/client-delivery/handler.mjs';

const secret='test-disposable-private-worker-secret-123456789';
const settings={
 enabled:true,workerSecret:secret,expectedAccount:'office@example.invalid',
 testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
 testReleasePackageId:'00000000-0000-4000-8000-000000000001',
 testReleaseDestinationId:'00000000-0000-4000-8000-000000000020',
 testRootFolderId:'disposable_client_root_0123456789',
 internalDriveId:'disposable_internal_drive_0123456789',
 testWorkspaceDomain:'example.invalid',
 expectedDriveId:'clientdrive_12345678901234567890',
 clientId:'private-client-id',clientSecret:'private-client-secret',
 refreshToken:'private-refresh-token',
 oauthScope:'https://www.googleapis.com/auth/drive.file',
 supabaseUrl:'https://fwh-test.supabase.co',
 serviceRoleJwt:'header.payload.signature'
};
const req=(operation='preallocate')=>new Request('https://private.invalid',{
 method:'POST',headers:{
  'x-fwh-delivery-secret':secret,'content-type':'application/json'
 },body:JSON.stringify({operation})
});
const path=url=>new URL(url).pathname;
const token=()=>Response.json({token_type:'Bearer',
 access_token:'disposable-oauth-access-token-123456789',expires_in:3600});
function harness({onClaim=()=>Response.json({claimed:false}),onToken=token,
 onRelease=()=>Response.json({released:true})}={}){
 let holder=null,oauth=0,claims=0,releases=0;
 const fetcher=async(raw,options)=>{
  const pathname=path(raw);
  if(pathname==='/rest/v1/rpc/service_acquire_delivery_dispatch'){
    const body=JSON.parse(options.body);
    assert.match(body.p_request,/^[a-f0-9-]{36}$/);
    if(holder!==null)return Response.json({acquired:false});
    holder=body.p_request;
    return Response.json({acquired:true});
  }
  if(pathname==='/rest/v1/rpc/service_release_delivery_dispatch'){
    const body=JSON.parse(options.body);
    assert.equal(body.p_request,holder);
    releases++;
    const out=await onRelease();
    if(out.ok){
      const data=await out.clone().json();
      if(data.released===true)holder=null;
    }
    return out;
  }
  if(pathname==='/rest/v1/rpc/service_claim_delivery')
    throw Error('BROAD_TEST_CLAIM_FORBIDDEN');
  if(pathname==='/rest/v1/rpc/service_claim_exact_test_delivery'){
    const params=JSON.parse(options.body);
    assert.deepEqual(params,{
      p_worker:params.p_worker,
      p_package:settings.testReleasePackageId,
      p_destination:settings.testReleaseDestinationId,
      p_root:settings.testRootFolderId
    });
    assert.match(params.p_worker,/^[a-f0-9-]{36}$/);
    claims++;return await onClaim();
  }
  if(pathname==='/token'){oauth++;return await onToken();}
  throw Error('UNEXPECTED_NETWORK_PATH '+pathname);
 };
 return {handler:createDeliveryHandler({...settings,fetcher}),fetcher,
  get holder(){return holder;},
  get oauth(){return oauth;},
  get claims(){return claims;},
  get releases(){return releases;}};
}

test('overlapping network wakeups: first owns permit, second performs no provider call',async()=>{
 let entered,proceed;
 const waiting=new Promise(resolve=>{entered=resolve;});
 const hold=new Promise(resolve=>{proceed=resolve;});
 const fixture=harness({onClaim:async()=>{
  entered();
  await hold;
  return Response.json({claimed:false});
 }});
 const first=fixture.handler(req());
 await waiting;
 // Independent Edge isolate/handler instance shares only the simulated
 // database singleton; an in-memory mutex would NOT reject this request.
 const separateIsolate=createDeliveryHandler({...settings,fetcher:fixture.fetcher});
 const second=await separateIsolate(req());
 assert.equal(second.status,503);
 assert.deepEqual(await second.json(),{status:'WORKER_BUSY'});
 assert.equal(fixture.claims,1);
 assert.equal(fixture.oauth,1);
 assert.equal(fixture.releases,0);
 proceed();
 const done=await first;
 assert.equal(done.status,200);
 assert.deepEqual(await done.json(),{status:'NO_ELIGIBLE_PACKAGES'});
 assert.equal(fixture.holder,null);
 assert.equal(fixture.releases,1);
 const next=await fixture.handler(req());
 assert.equal(next.status,200);
 assert.equal(fixture.claims,2);
 assert.equal(fixture.releases,2);
});

test('OAuth uncertain leaves durable dispatch occupied: no blind retry or duplicate claim',async()=>{
 const fixture=harness({onToken:async()=>{throw Error('PRIVATE_SECRET');}});
 const first=await fixture.handler(req());
 assert.equal(first.status,503);
 assert.deepEqual(await first.json(),{status:'TRUSTED_PROVIDER_UNAVAILABLE'});
 assert.notEqual(fixture.holder,null);
 assert.equal(fixture.claims,0);
 assert.equal(fixture.releases,0);
 const again=await fixture.handler(req());
 assert.equal(again.status,503);
 assert.deepEqual(await again.json(),{status:'WORKER_BUSY'});
 assert.equal(fixture.oauth,1);
 assert.equal(fixture.claims,0);
});

test('unconfirmed release response does not claim a completed dispatch',async()=>{
 const fixture=harness({onRelease:()=>Response.json({released:false})});
 const first=await fixture.handler(req());
 assert.equal(first.status,503);
 assert.deepEqual(await first.json(),{status:'TRUSTED_PROVIDER_UNAVAILABLE'});
 assert.equal(fixture.releases,1);
 assert.notEqual(fixture.holder,null);
 const another=await fixture.handler(req());
 assert.equal(another.status,503);
 assert.equal((await another.json()).status,'WORKER_BUSY');
 assert.equal(fixture.claims,1);
});

test('malformed, off and wrong-secret calls never acquire a dispatch permit',async()=>{
 let calls=0;
 const f=()=>{calls++;throw Error('NO_NETWORK_ALLOWED');};
 const off=createDeliveryHandler({...settings,enabled:false,fetcher:f});
 assert.equal((await off(req())).status,503);
 const on=createDeliveryHandler({...settings,fetcher:f});
 assert.equal((await on(new Request('https://private.invalid',{
  method:'POST',headers:{'x-fwh-delivery-secret':'wrong',
   'content-type':'application/json'},
  body:JSON.stringify({operation:'preallocate'})
 }))).status,401);
 assert.equal((await on(new Request('https://private.invalid',{
  method:'POST',headers:{'x-fwh-delivery-secret':secret,
   'content-type':'application/json'},
  body:JSON.stringify({operation:'preallocate',force:true})
 }))).status,400);
 assert.equal(calls,0);
});
