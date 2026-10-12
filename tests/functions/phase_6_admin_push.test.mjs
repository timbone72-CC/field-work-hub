import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminPushHandler,allowedWebPushEndpoint}
 from '../../supabase/functions/admin-web-push/handler.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const secret='synthetic-only-fwh-admin-push-secret-32-plus';
const worker=uuid(1),issue=uuid(2),job=uuid(3),device=uuid(4);
const request=({key=secret,operation='tick',method='POST'}={})=>new Request(
 'https://edge.invalid/admin-web-push',{method,
 headers:{'content-type':'application/json','x-fwh-push-secret':key},
 body:method==='POST'?JSON.stringify({operation}):undefined});
function fixture({endpoint='https://fcm.googleapis.com/fcm/send/opaque',
 providerStatus=201,providerError=null,ready=true,more=false}={}){
 const observations={claim:0,prepare:0,finish:[],sends:[]};
 const ledger={
  async prepare(x){observations.prepare++;assert.equal(x.p_limit,50);
    return {processed_work_orders:10,next_cursor:more&&observations.prepare===1?uuid(8):null};},
  async claim(x){assert.equal(x.p_worker,worker);observations.claim++;
    return observations.claim===1?{job_id:job,alert_id:issue,endpoint,
     p256dh:'synthetic-public-key',auth:'synthetic-auth-secret',
     vapid_public_key:'synthetic-public-vapid',generation:1}:{claimed:false};},
  async finish(v){observations.finish.push(v);return {state:'PUSH_ACCEPTED_BY_SERVICE'};}
 };
 const sendPush=async(subscription,payload)=>{
   observations.sends.push({subscription,payload});
   if(providerError)throw providerError;
   return providerStatus;
 };
 return {handler:createAdminPushHandler({enabled:ready,workerSecret:secret,
   vapidPublicKey:'synthetic-public-vapid',ledger,sendPush,
   makeWorkerId:()=>worker}),observations};
}
test('provider allowlist rejects SSRF, local and insecure network destinations',()=>{
 for(const uri of ['http://fcm.googleapis.com/fcm/send/x',
  'https://localhost/internal','https://127.0.0.1/x',
  'https://fcm.googleapis.com.evil.invalid/x',
  'https://user@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x',
  'https://169.254.169.254/meta','https://host.local/x']){
   assert.equal(allowedWebPushEndpoint(uri),false,uri);
 }
 assert.equal(allowedWebPushEndpoint('https://fcm.googleapis.com/fcm/send/valid'),true);
});
test('no anonymous, wrong-secret, or disabled worker can claim/push',async()=>{
 const {handler,observations}=fixture({ready:false});
 assert.equal((await handler(request())).status,503);
 assert.equal((await handler(request({key:'wrong'}))).status,401);
 assert.equal((await handler(request({method:'GET'}))).status,405);
 assert.equal(observations.prepare,0);
 assert.equal(observations.sends.length,0);
});
test('only opaque alert ID and relative link leave via encrypted Push service',async()=>{
 const {handler,observations}=fixture();
 const response=await handler(request());assert.equal(response.status,200);
 assert.equal((await response.json()).state,'SERVICE_ATTEMPTS_RECORDED');
 assert.equal(observations.prepare,1);
 assert.equal(observations.sends.length,1);
 const p=JSON.parse(observations.sends[0].payload);
 assert.deepEqual(p,{alert_id:issue,path:'./?alert='+issue});
 assert.equal(observations.finish.length,1);
 assert.deepEqual(observations.finish[0],{
    p_job:job,p_worker:worker,p_generation:1,p_http_status:201});
});
test('unexpected endpoint never triggers external provider request',async()=>{
 const {handler,observations}=fixture({endpoint:'https://127.0.0.1/internal'});
 assert.equal((await handler(request())).status,503);
 assert.equal(observations.sends.length,0);
 assert.equal(observations.finish.length,0);
});
test('identified provider 410 is recorded distinctly from OS display',async()=>{
 const {handler,observations}=fixture({providerError:Object.assign(
   Error('synthetic expired'),{statusCode:410})});
 assert.equal((await handler(request())).status,200);
 assert.equal(observations.finish[0].p_http_status,410);
});
test('ambiguous provider exception preserves lease rather than blindly retry',async()=>{
 const {handler,observations}=fixture({providerError:Error('synthetic network uncertainty')});
 assert.equal((await handler(request())).status,503);
 assert.equal(observations.sends.length,1);
 assert.equal(observations.finish.length,0);
});
test('paged evaluation clearly reports an incomplete service pass',async()=>{
 const {handler,observations}=fixture({more:true});
 assert.equal((await (await handler(request())).json()).state,'SERVICE_ATTEMPTS_RECORDED');
 assert.equal(observations.prepare,2);
});
