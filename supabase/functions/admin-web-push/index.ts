// Source-only. Never deploy/enroll without VAPID + scoped Team org,
// verified scheduler, live browser/provider gate, and Level-3 approval.
import webpush from 'npm:web-push@3.6.7';
import {createAdminPushHandler} from './handler.mjs';

const url=Deno.env.get('SUPABASE_URL')??'';
const credential=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const secret=Deno.env.get('FWH_ADMIN_PUSH_WORKER_SECRET')??'';
const publicKey=Deno.env.get('FWH_ADMIN_VAPID_PUBLIC_KEY')??'';
const privateKey=Deno.env.get('FWH_ADMIN_VAPID_PRIVATE_KEY')??'';
const contact=Deno.env.get('FWH_ADMIN_VAPID_CONTACT')??'';
const enabled=Deno.env.get('FWH_ADMIN_PUSH_ENABLED')==='true'
  &&url.startsWith('https://')&&credential.length>32&&secret.length>=32
  &&publicKey.length>=86&&privateKey.length>=40
  &&contact.startsWith('mailto:');
if(enabled)webpush.setVapidDetails(contact,publicKey,privateKey);

const ledger={
 async call(name,payload){
   const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',
     headers:{apikey:credential,Authorization:'Bearer '+credential,
       'Content-Type':'application/json'},body:JSON.stringify(payload),
     signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('Trusted alert ledger returned non-success');
   return r.json();
 },
 prepare(p){return this.call('service_prepare_admin_push',p);},
 claim(p){return this.call('service_claim_admin_push',p);},
 finish(p){return this.call('service_finish_admin_push',p);}
};
const handler=createAdminPushHandler({
 enabled,workerSecret:secret,vapidPublicKey:publicKey,ledger,
 sendPush:async(subscription,payload)=>{
   const result=await webpush.sendNotification(subscription,payload,{
     TTL:3600,timeout:10000,urgency:'normal'});
   return result.statusCode;
 }
});
Deno.serve(handler);
