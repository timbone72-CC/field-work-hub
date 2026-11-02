/* Phase 6E. Trusted backend-only Web Push dispatcher. Disabled at source
 * until verified VAPID, exact Team org runtime and approved scheduler gate. */
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function response(status,state){return new Response(JSON.stringify({state}),{
 status,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private'}});}
function equalSecret(given,expected){
 if(!given||!expected||typeof given!=='string'||typeof expected!=='string')return false;
 const a=new TextEncoder().encode(given),b=new TextEncoder().encode(expected);
 let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)
   diff|=(a[i]??0)^(b[i]??0);
 return diff===0;
}
export function allowedWebPushEndpoint(value){
 if(typeof value!=='string'||value.length>2048||value.length<20)return false;
 let url;try{url=new URL(value);}catch{return false;}
 if(url.protocol!=='https:'||url.username||url.password||url.hash
    ||url.port&&url.port!=='443'
    ||url.hostname.endsWith('.local')||url.hostname==='localhost')return false;
 const host=url.hostname.toLowerCase();
 return host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'
  ||host.endsWith('.notify.windows.com')&&host.length>('.notify.windows.com').length
  ||host.endsWith('.push.apple.com')&&host.length>('.push.apple.com').length;
}
export function createAdminPushHandler({
 enabled=false,workerSecret='',vapidPublicKey='',ledger,sendPush,
 makeWorkerId=()=>crypto.randomUUID()
}={}){
 return async request=>{
  if(request.method!=='POST')return response(405,'POST_ONLY');
  if(workerSecret.length<32||
    !equalSecret(request.headers.get('x-fwh-push-secret'),workerSecret))
   return response(401,'WORKER_UNAUTHORIZED');
  if(!enabled||!vapidPublicKey||typeof ledger?.prepare!=='function'
    ||typeof ledger?.claim!=='function'||typeof ledger?.finish!=='function'
    ||typeof sendPush!=='function')return response(503,'NOT_ACTIVATED');
  let body;try{
   if(request.headers.get('content-type')!=='application/json')return response(400,'EXACT_JSON_REQUIRED');
   const raw=await request.text();if(raw.length>160)return response(413,'TOO_LARGE');
   body=JSON.parse(raw);
  }catch{return response(400,'EXACT_JSON_REQUIRED');}
  if(!body||Object.keys(body).length!==1||body.operation!=='tick')
    return response(400,'OPERATION_DENIED');
  try{
   let cursor=null;
   // Bounded 10 pages = at most 500 server-evaluated WOs per invocation.
   // If more remain, do not claim a complete organization scan.
   for(let page=0;page<10;page++){
     const r=await ledger.prepare({p_after:cursor,p_limit:50});
     if(!Number.isInteger(r.processed_work_orders)||r.processed_work_orders>50)
       throw Error('Invalid bounded work evaluation');
     cursor=r.next_cursor||null;
     if(!cursor)break;
   }
   const worker=makeWorkerId();
   if(!id.test(worker))throw Error('Invalid worker identity');
   let sent=0;
   for(let i=0;i<5;i++){
     const job=await ledger.claim({p_worker:worker});
     if(job.claimed===false)break;
     if(!id.test(job.job_id)||!id.test(job.alert_id)
       ||!allowedWebPushEndpoint(job.endpoint)
       ||!job.p256dh||!job.auth||job.vapid_public_key!==vapidPublicKey)
       throw Error('Claimed device/identity invalid; hold lease for reconciliation');
     const payload=JSON.stringify({
       alert_id:job.alert_id,path:'./?alert='+job.alert_id
     });
     let status;
     try{
       status=await sendPush({
         endpoint:job.endpoint,keys:{p256dh:job.p256dh,auth:job.auth}
       },payload);
     }catch(e){
       // Network uncertainty is NOT proof the push was unsent. Retain the
       // lease for a governed reconciler, not a blind second provider POST.
       if(!Number.isInteger(e?.statusCode))throw e;
       status=e.statusCode;
     }
     if(!Number.isInteger(status)||status<100||status>599)
       throw Error('Unverifiable push service status');
     await ledger.finish({p_job:job.job_id,p_worker:worker,
       p_generation:job.generation,p_http_status:status});
     sent++;
   }
   return response(200,cursor?'BOUNDED_SCAN_MORE_REMAINS':
     sent?'SERVICE_ATTEMPTS_RECORDED':'NO_ELIGIBLE_PUSH');
  }catch{
   // Never echo endpoint, subscription keys, client info, org, IDs, or remote
   // provider error body into a scheduler-accessible response.
   return response(503,'PUSH_UNCERTAIN_OR_UNAVAILABLE');
  }
 };
}
