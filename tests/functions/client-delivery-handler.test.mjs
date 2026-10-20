import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler}
 from '../../supabase/functions/client-delivery/handler.mjs';
const secret='disposable-only-worker-secret-1234567890';
const request=(key=secret,body={operation:'preallocate'})=>new Request('https://any.invalid',{
 method:'POST',headers:{'x-fwh-delivery-secret':key,'content-type':'application/json'},
 body:JSON.stringify(body)
});
test('no user, publishable key or wrong worker secret can invoke the provider backend',async()=>{
 let calls=0;
 const handler=createDeliveryHandler({enabled:true,workerSecret:secret,
  fetcher:()=>{calls++;throw Error('private token');}});
 for(const key of ['', 'sb_publishable_public',secret.slice(0,-1)+'z']){
  const r=await handler(request(key));
  assert.equal(r.status,401);
  assert.equal((await r.json()).status,'WORKER_UNAUTHORIZED');
 }
 assert.equal(calls,0);
});
test('delivery preflight stays disabled by default even for exact internal worker key',async()=>{
 let calls=0;
 const handler=createDeliveryHandler({workerSecret:secret,
  fetcher:()=>{calls++;throw Error('should not send');}});
 const response=await handler(request());
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{status:'WORKER_NOT_ACTIVATED'});
 assert.equal(calls,0);
});
test('only an explicit internal preallocation command can be recognized',async()=>{
 const handler=createDeliveryHandler({enabled:true,workerSecret:secret});
 for(const payload of [{operation:'send'}, {operation:'preallocate',packageId:'foreign'},
  {},['preallocate']]){
   const resp=await handler(request(secret,payload));
   assert.equal(resp.status,400);
 }
 const missing=await handler(request());
 assert.equal(missing.status,503);
 assert.equal((await missing.json()).status,'BACKEND_NOT_CONFIGURED');
});
test('provider/token errors are redacted and cannot claim a delivered package',async()=>{
 const handler=createDeliveryHandler({enabled:true,workerSecret:secret,
   expectedAccount:'office@example.invalid',
   expectedDriveId:'testdrive01234567',
   clientId:'disposable-client-id-123456789',
   clientSecret:'disposable-client-secret-123456',
   refreshToken:'disposable-refresh-123456789',
   oauthScope:'https://www.googleapis.com/auth/drive.file',
   supabaseUrl:'https://fwh-test.supabase.co',
   serviceRoleJwt:'header.payload.signature',
   fetcher:()=>{throw Error('DO_NOT_LEAK_PROVIDER_TOKEN');}
 });
 const response=await handler(request());
 assert.equal(response.status,503);
 const body=await response.text();
 assert.equal(body.includes('DO_NOT_LEAK'),false);
 assert.equal(body.includes('refresh'),false);
 assert.equal(body.includes('DELIVERED'),false);
 assert.equal(body,'{"status":"DISPATCH_PERMIT_UNAVAILABLE"}');
});
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const leased={package_id:uuid(1),worker_id:uuid(2),generation:1};
const candidateConfig={
 enabled:true,workerSecret:secret,expectedAccount:'office@example.invalid',
 expectedDriveId:'clientdrive_12345678901234567890',
 clientId:'private-client-id',clientSecret:'private-client-secret',
 refreshToken:'private-refresh-token',
 oauthScope:'https://www.googleapis.com/auth/drive.file',
 supabaseUrl:'https://fwh-test.supabase.co',
 serviceRoleJwt:'header.payload.signature'
};
test('leased continuation is disabled even with valid worker secret and fields',async()=>{
 let calls=0;
 const h=createDeliveryHandler({...candidateConfig,enabled:false,
  fetcher:()=>{calls++;throw Error('network is forbidden');}});
 for(const operation of ['reconcile_parent','reconcile_geographic_leaf',
    'reconcile_package_folder','transfer_one_chunk']){
   const payload={operation,...leased};
   if(operation==='reconcile_parent')payload.kind='STATE';
   else if(operation==='reconcile_geographic_leaf')payload.kind='ADDRESS';
   else payload.plan_id=uuid(3);
   const result=await h(request(secret,payload));
   assert.equal(result.status,503);
   assert.deepEqual(await result.json(),{status:'WORKER_NOT_ACTIVATED'});
 }
 assert.equal(calls,0);
});
test('leased continuation requires exact frozen lease identities and operation shape',async()=>{
 let calls=0;
 const h=createDeliveryHandler({...candidateConfig,
   fetcher:()=>{calls++;throw Error('should not run');}});
 const valid={operation:'reconcile_parent',...leased,kind:'STATE'};
 const invalid=[
  {...valid,kind:'ADDRESS'}, // geographic leaf must not use legacy owner
  {...valid,kind:'WORK_ORDER'},
  {...valid,package_id:uuid(9),extra:'untrusted'},
  {...valid,package_id:'../../other-org'},
  {...valid,worker_id:'other-user'},
  {...valid,generation:0},
  {...valid,generation:1.1},
  {...valid,generation:'1'},
  {...valid,operation:'reconcile_geographic_leaf',kind:'STATE'},
  {operation:'transfer_one_chunk',...leased,plan_id:'wrong'},
  {operation:'reconcile_package_folder',...leased,plan_id:uuid(3),forceCreate:true},
  {operation:'send',...leased},
  ['reconcile_parent']
 ];
 for(const body of invalid){
   const res=await h(request(secret,body));
   assert.equal(res.status,400);
   assert.deepEqual(await res.json(),{status:'EXACT_REQUEST_REQUIRED'});
 }
 assert.equal(calls,0);
});
test('leased file chunk requires server-only AES-GCM secret, never a substitute session',async()=>{
 let calls=0;
 const h=createDeliveryHandler({...candidateConfig,
   fetcher:()=>{calls++;throw Error('unexpected network');}});
 const r=await h(request(secret,{operation:'transfer_one_chunk',
   ...leased,plan_id:uuid(3)}));
 assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{status:'SESSION_KEY_NOT_CONFIGURED'});
 assert.equal(calls,0);
});
test('invalid encrypted-session key stops all active chunk-capable worker operations before persistent dispatch',async()=>{
 for(const operation of ['advance_once','transfer_one_chunk']){
  for(const key of [undefined,'not-base64', 'A'.repeat(22)]){
   let calls=0;
   const h=createDeliveryHandler({...candidateConfig,sessionVaultKey:key,
     fetcher:()=>{calls++;throw Error('UNEXPECTED_NETWORK_CALL');}});
   const body=operation==='advance_once'?{operation}:{
     operation,...leased,plan_id:uuid(3)
   };
   const r=await h(request(secret,body));
   assert.equal(r.status,503,operation);
   assert.deepEqual(await r.json(),{status:'SESSION_KEY_NOT_CONFIGURED'});
   assert.equal(calls,0,'no global permit, provider or OAuth is touched');
  }
 }
});
test('private continuation errors are redacted with no new Google write on OAuth failure',async()=>{
 const paths=[];
 const h=createDeliveryHandler({...candidateConfig,
   fetcher:(raw,opts)=>{const pathname=new URL(raw).pathname;
      paths.push([pathname,opts.method||'GET']);
      if(pathname==='/rest/v1/rpc/service_acquire_delivery_dispatch')
        return Response.json({acquired:true});
      throw Error('DO_NOT_LEAK_AUTH_OR_IDENTITY');}});
 const result=await h(request(secret,{operation:'reconcile_parent',
   ...leased,kind:'STATE'}));
 assert.equal(result.status,503);
 const text=await result.text();
 assert.equal(text,'{"status":"TRUSTED_PROVIDER_UNAVAILABLE"}');
 assert.equal(text.includes('DO_NOT_LEAK'),false);
 assert.equal(text.includes(leased.package_id),false);
 assert.deepEqual(paths,[
  ['/rest/v1/rpc/service_acquire_delivery_dispatch','POST'],
  ['/token','POST']
 ]);
});
test('advance_once accepts no caller-controlled work or folder identity',async()=>{
 let touched=0;
 const h=createDeliveryHandler({...candidateConfig,
  fetcher:()=>{touched++;throw Error('unexpected');}});
 for(const malformed of [
  {operation:'advance_once',package_id:uuid(1)},
  {operation:'advance_once',worker_id:uuid(1)},
  {operation:'advance_once',generation:1},
  {operation:'advance_once',kind:'STATE'},
  {operation:'advance_once',forceSend:true}
 ]){
  const r=await h(request(secret,malformed));
  assert.equal(r.status,400);
  assert.deepEqual(await r.json(),{status:'EXACT_REQUEST_REQUIRED'});
 }
 assert.equal(touched,0);
});
test('expired original lease blocks advance_once without Google OAuth or new claim',async()=>{
 const calls=[];
 const h=createDeliveryHandler({...candidateConfig,
  sessionVaultKey:'A'.repeat(43), // valid disposable 32-byte AES-GCM key
  fetcher:async(raw,opts)=>{
  const u=new URL(raw);calls.push([u.pathname,opts.method]);
  assert.equal(opts.headers.Authorization,'Bearer '+candidateConfig.serviceRoleJwt);
  if(u.pathname==='/rest/v1/rpc/service_acquire_delivery_dispatch')
    return Response.json({acquired:true});
  assert.equal(u.pathname,'/rest/v1/rpc/service_read_active_delivery_lease');
  return Response.json({state:'BLOCKED_UNCERTAIN'});
 }});
 const r=await h(request(secret,{operation:'advance_once'}));
 assert.equal(r.status,503);
 const text=await r.text();
 assert.equal(text,'{"status":"TRUSTED_PROVIDER_UNAVAILABLE"}');
 assert.deepEqual(calls,[
  ['/rest/v1/rpc/service_acquire_delivery_dispatch','POST'],
  ['/rest/v1/rpc/service_read_active_delivery_lease','POST']
 ]);
});
test('default-off scheduler wakeup performs no claim, Google GET or file write',async()=>{
 let count=0;
 const h=createDeliveryHandler({...candidateConfig,enabled:false,
  fetcher:()=>{count++;throw Error('unexpected');}});
 const r=await h(request(secret,{operation:'advance_once'}));
 assert.equal(r.status,503);
 assert.equal((await r.json()).status,'WORKER_NOT_ACTIVATED');
 assert.equal(count,0);
});
test('Deno source defaults delivery OFF on empty provider configuration',async()=>{
 const prior=globalThis.Deno;
 let installed=null;
 globalThis.Deno={env:{get:()=>undefined},serve:handler=>{installed=handler;}};
 try{await import('../../supabase/functions/client-delivery/index.ts');}
 finally{globalThis.Deno=prior;}
 assert.equal(typeof installed,'function');
 const response=await installed(request());
 assert.equal(response.status,401); // empty worker secret cannot authenticate.
});
