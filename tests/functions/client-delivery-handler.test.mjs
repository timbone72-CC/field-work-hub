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
 assert.equal(body,'{"status":"TRUSTED_PROVIDER_UNAVAILABLE"}');
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
