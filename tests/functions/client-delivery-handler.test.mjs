import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler}
 from '../../supabase/functions/client-delivery/handler.mjs';
const secret='disposable-only-worker-secret-1234567890';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const isolatedTest={
 testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
 testReleasePackageId:uuid(1),testReleaseDestinationId:uuid(20),
 testRootFolderId:'disposable_client_root_0123456789',
 internalDriveId:'disposable_internal_drive_0123456789',
 testWorkspaceDomain:'example.invalid'
};
const request=(key=secret,body={operation:'preallocate'})=>new Request('https://any.invalid',{
 method:'POST',headers:{'x-fwh-delivery-secret':key,'content-type':'application/json'},
 body:JSON.stringify(body)
});
test('no user, publishable key or wrong worker secret can invoke the provider backend',async()=>{
 let calls=0;
 const handler=createDeliveryHandler({enabled:true,...isolatedTest,workerSecret:secret,
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
 assert.equal((await missing.json()).status,'TEST_RELEASE_SCOPE_NOT_CONFIGURED');
});
test('provider/token errors are redacted and cannot claim a delivered package',async()=>{
 const handler=createDeliveryHandler({enabled:true,...isolatedTest,workerSecret:secret,
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
const leased={package_id:uuid(1),worker_id:uuid(2),generation:1};
const candidateConfig={
 ...isolatedTest,enabled:true,workerSecret:secret,expectedAccount:'office@example.invalid',
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
test('invalid local OAuth adapter config cannot reserve persistent dispatch for any active operation',async()=>{
 const goodVault=Buffer.alloc(32,7).toString('base64');
 const operations=[
   {operation:'preallocate'}, {operation:'advance_once'},
   {operation:'reconcile_parent',...leased,kind:'STATE'},
   {operation:'reconcile_geographic_leaf',...leased,kind:'ADDRESS'},
   {operation:'reconcile_package_folder',...leased,plan_id:uuid(3)},
   {operation:'transfer_one_chunk',...leased,plan_id:uuid(3)}
 ];
 const badConfigs=[
   {clientId:'too-short'},
   {clientSecret:'too-short'},
   {refreshToken:'invalid token with spaces'},
   {oauthScope:'https://www.googleapis.com/auth/drive.readonly'}
 ];
 for(const bad of badConfigs)for(const operation of operations){
   let network=0;
   const h=createDeliveryHandler({...candidateConfig,...bad,
     sessionVaultKey:goodVault,
     fetcher:()=>{network++;throw Error('UNEXPECTED_DISPATCH_OR_PROVIDER_NETWORK');}});
   const response=await h(request(secret,operation));
   assert.equal(response.status,503,operation.operation);
   assert.deepEqual(await response.json(),{status:'BACKEND_OAUTH_NOT_CONFIGURED'});
   assert.equal(network,0,'no network, singleton permit, token or Google request');
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


test('TEST-only backend read-only diagnosis uses only original protected read RPC',async()=>{
  const calls=[];
  const h=createDeliveryHandler({...candidateConfig,fetcher:async(raw,opts)=>{
    const url=new URL(raw);
    calls.push({origin:url.origin,path:url.pathname,method:opts?.method,body:opts?.body});
    return Response.json({state:'NONE'});
  }});
  const r=await h(request(secret,{operation:'check_backend_readonly'}));
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{status:'BACKEND_READ_ONLY_OK'});
  assert.deepEqual(calls,[{
    origin:'https://fwh-test.supabase.co',
    path:'/rest/v1/rpc/service_read_active_delivery_lease',
    method:'POST',body:'{}'
  }]);
});
test('hosted read-only adapter accepts only backend secret key on apikey header',async()=>{
  const secretKey='sb_secret_'+'k'.repeat(32),requests=[];
  const h=createDeliveryHandler({...candidateConfig,serviceRoleJwt:secretKey,
    fetcher:async(url,opts)=>{
      requests.push({url,opts});
      return Response.json({state:'NONE'});
    }});
  const r=await h(request(secret,{operation:'check_backend_readonly'}));
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{status:'BACKEND_READ_ONLY_OK'});
  assert.equal(requests.length,1);
  assert.equal(new URL(requests[0].url).pathname,
    '/rest/v1/rpc/service_read_active_delivery_lease');
  assert.equal(requests[0].opts.headers.apikey,secretKey);
  assert.equal(Object.hasOwn(requests[0].opts.headers,'Authorization'),false);
  let calls=0;
  const rejected=createDeliveryHandler({...candidateConfig,
    serviceRoleJwt:'sb_publishable_'+'p'.repeat(32),
    fetcher:()=>{calls++;throw Error('NO_IO_ALLOWED');}});
  const bad=await rejected(request(secret,{operation:'check_backend_readonly'}));
  assert.equal(bad.status,503);
  assert.deepEqual(await bad.json(),{status:'BACKEND_KEY_FORMAT_INVALID'});
  assert.equal(calls,0);
});

test('TEST-only backend check cannot bypass worker secret, mode, pinning or shape',async()=>{
  let calls=0;
  const fetcher=()=>{calls++;throw Error('NO_IO_EXPECTED');};
  const configs=[
    [candidateConfig,request('incorrect-worker-secret-1234567890',{operation:'check_backend_readonly'}),401],
    [{...candidateConfig,enabled:false},request(secret,{operation:'check_backend_readonly'}),503],
    [{...candidateConfig,testRootFolderId:candidateConfig.expectedDriveId},
      request(secret,{operation:'check_backend_readonly'}),503],
    [candidateConfig,request(secret,{operation:'check_backend_readonly',package_id:uuid(1)}),400]
  ];
  for(const [cfg,req,expected] of configs){
    const r=await createDeliveryHandler({...cfg,fetcher})(req);
    assert.equal(r.status,expected);
  }
  assert.equal(calls,0);
});
test('TEST-only backend check redacts adapter, denied, network and response failures',async()=>{
  const body={operation:'check_backend_readonly'};
  const invalid=createDeliveryHandler({...candidateConfig,
    serviceRoleJwt:'sb_secret_fake-format',fetcher:()=>{throw Error('NO_NETWORK');}});
  const a=await invalid(request(secret,body));
  assert.equal(a.status,503);
  assert.deepEqual(await a.json(),{status:'BACKEND_KEY_FORMAT_INVALID'});
  for(const invalidUrl of ['http://fwh-test.supabase.co',
    'https://fwh-test.supabase.co/unapproved']){
    const invalidBackend=createDeliveryHandler({...candidateConfig,
      supabaseUrl:invalidUrl,fetcher:()=>{throw Error('NO_IO_ALLOWED');}});
    const result=await invalidBackend(request(secret,body));
    assert.equal(result.status,503);
    assert.deepEqual(await result.json(),{status:'BACKEND_URL_INVALID'});
  }
  for(const [response,code] of [
    [()=>Response.json({message:'PRIVATE_TOKEN'},{status:403}),'BACKEND_READ_ONLY_AUTH_DENIED'],
    [()=>Response.json({message:'PRIVATE_TOKEN'},{status:500}),'BACKEND_READ_ONLY_RPC_UNAVAILABLE'],
    [()=>{throw Error('PRIVATE_TOKEN');},'BACKEND_READ_ONLY_NETWORK_UNAVAILABLE'],
    [()=>Response.json({state:'INVALID'}),'BACKEND_READ_ONLY_RESPONSE_INVALID'],
    [()=>new Response('not-json'),'BACKEND_READ_ONLY_UNVERIFIED']
  ]){
    let calls=0;
    const h=createDeliveryHandler({...candidateConfig,fetcher:(...args)=>{
      calls++;assert.equal(new URL(args[0]).pathname,'/rest/v1/rpc/service_read_active_delivery_lease');
      return response(...args);
    }});
    const r=await h(request(secret,body));
    assert.equal(r.status,503,code);
    const txt=await r.text();
    assert.deepEqual(JSON.parse(txt),{status:code});
    assert.equal(txt.includes('PRIVATE_TOKEN'),false);
    assert.equal(calls,1);
  }
});

test('exact TEST expired-ID probe calls only read-only SQL, OAuth and three Google GETs',async()=>{
 const events=[];
 const orig='reserved_original_id_0123456789';
 const sha='a'.repeat(64);
 const snapshot={
  state:'EXPIRED_RESERVED_PARENT',
  package_id:isolatedTest.testReleasePackageId,
  destination_id:isolatedTest.testReleaseDestinationId,
  worker_id:uuid(90),generation:1,attempts:1,
  approved_sha256:sha,lease_until:new Date(Date.now()-60000).toISOString(),
  file_plans:0,upload_sessions:0,final_receipts:0,dispatch_permits:0,
  manifest:{package_id:isolatedTest.testReleasePackageId,
   destination_id:isolatedTest.testReleaseDestinationId,
   destination_root:isolatedTest.testRootFolderId,
   selected_photos:[{photo_id:uuid(11)},{photo_id:uuid(12)}]},
  parent:{map_id:uuid(91),kind:'ADDRESS',state:'RESERVED',create_attempts:0,
   remote_folder_id:orig,parent_remote_id:isolatedTest.testRootFolderId}
 };
 const fetcher=async(raw,opts)=>{
  const target=new URL(raw),path=target.pathname;
  events.push([target.origin,path,opts.method??'GET']);
  assert.equal(opts.redirect,'error');
  if(path==='/rest/v1/rpc/service_read_expired_test_delivery_reservation'){
   assert.equal(opts.method,'POST');
   assert.deepEqual(JSON.parse(opts.body),{
    p_package:isolatedTest.testReleasePackageId,
    p_destination:isolatedTest.testReleaseDestinationId,
    p_root:isolatedTest.testRootFolderId
   });
   return Response.json(snapshot);
  }
  if(target.origin==='https://oauth2.googleapis.com'&&path==='/token'){
   assert.equal(opts.method,'POST');
   return Response.json({token_type:'Bearer',
    access_token:'disposable-token-for-readonly-google-only-123456789',
    expires_in:3600,scope:candidateConfig.oauthScope});
  }
  assert.equal(target.origin,'https://www.googleapis.com');
  assert.equal(opts.method??'GET','GET');
  if(path==='/drive/v3/about'){
   return Response.json({user:{emailAddress:candidateConfig.expectedAccount,
    me:true,permissionId:'test-only-identity'}});
  }
  if(path==='/drive/v3/files/'+isolatedTest.testRootFolderId){
   return Response.json({id:isolatedTest.testRootFolderId,
    trashed:false,mimeType:'application/vnd.google-apps.folder',
    driveId:candidateConfig.expectedDriveId,
    capabilities:{canAddChildren:true}});
  }
  if(path==='/drive/v3/files/'+orig){
   assert.equal(target.searchParams.get('supportsAllDrives'),'true');
   return Response.json({error:'No accessible object for original ID'},{status:404});
  }
  throw Error('No other provider or backend route allowed');
 };
 const handler=createDeliveryHandler({...candidateConfig,fetcher});
 const response=await handler(request(secret,{operation:'inspect_expired_readonly'}));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{status:'ORIGINAL_ID_NOT_FOUND_READ_ONLY'});
 assert.deepEqual(events,[
  ['https://fwh-test.supabase.co',
   '/rest/v1/rpc/service_read_expired_test_delivery_reservation','POST'],
  ['https://oauth2.googleapis.com','/token','POST'],
  ['https://www.googleapis.com','/drive/v3/about','GET'],
  ['https://www.googleapis.com','/drive/v3/files/'+isolatedTest.testRootFolderId,'GET'],
  ['https://www.googleapis.com','/drive/v3/files/'+orig,'GET']
 ]);
 assert.equal(events.some(([,,method])=>method==='PUT'||method==='DELETE'),false);
 assert.equal(events.some(([,path])=>/dispatch|renew|resume|generateIds|upload/.test(path)),false);
});
test('expired-ID probe fails closed for unauthorized, unactivated, malformed or unexpected backend response',async()=>{
 let calls=0;
 for(const [cfg,req,status] of [
  [candidateConfig,request('wrong-secret',{operation:'inspect_expired_readonly'}),401],
  [{...candidateConfig,enabled:false},request(secret,{operation:'inspect_expired_readonly'}),503],
  [candidateConfig,request(secret,{operation:'inspect_expired_readonly',package_id:uuid(1)}),400],
  [{...candidateConfig,testReleasePackageId:uuid(91).slice(0,2)},request(secret,{operation:'inspect_expired_readonly'}),503]
 ]){
  const h=createDeliveryHandler({...cfg,fetcher:()=>{calls++;throw Error('FORBIDDEN_IO');}});
  const r=await h(req);assert.equal(r.status,status);
 }
 assert.equal(calls,0);
 const h=createDeliveryHandler({...candidateConfig,
  fetcher:async(raw,opts)=>{
   const u=new URL(raw);
   assert.equal(u.pathname,'/rest/v1/rpc/service_read_expired_test_delivery_reservation');
   assert.equal(opts.method,'POST');
   return Response.json({state:'BLOCKED_UNCERTAIN'});
  }});
 const refused=await h(request(secret,{operation:'inspect_expired_readonly'}));
 assert.equal(refused.status,503);
 assert.deepEqual(await refused.json(),{status:'ORIGINAL_ID_INSPECTION_UNVERIFIED'});
});
