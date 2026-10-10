// PRIVATE backend-only, intentionally inactive until real provider evidence.
// No browser CORS. No file writes, photo deletion, scheduler or client Send.
// Real OAuth and destination must pass provider gate before ACTIVE may be true.
import {createWorkspaceTokenProvider} from './workspace-oauth.mjs';
import {createServiceLedger} from './service-ledger.mjs';
import {prepareTrustedDelivery} from './worker-runtime.mjs';

function reply(status,code) {
 return new Response(JSON.stringify({status:code}),{status,headers:{
  'Content-Type':'application/json','Cache-Control':'no-store, private'
 }});
}
// Compare fixed-length private worker key without early return on mismatch.
function sameSecret(x,y){
 if(typeof x!=='string'||typeof y!=='string'||!x||!y)return false;
 const a=new TextEncoder().encode(x),b=new TextEncoder().encode(y);
 let different=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)
  different|=(a[i]??0)^(b[i]??0);
 return different===0;
}
export function createDeliveryHandler({
  enabled=false,workerSecret,expectedAccount,expectedDriveId,
  clientId,clientSecret,refreshToken,oauthScope,
  supabaseUrl,serviceRoleJwt,
  fetcher=fetch,makeWorkerId=()=>crypto.randomUUID()
}={}){
 return async request=>{
  if(request.method!=='POST')return reply(405,'POST_ONLY');
  // No credential-less status, probe or public health route.
  if(!workerSecret||workerSecret.length<32
   ||!sameSecret(request.headers.get('x-fwh-delivery-secret'),workerSecret))
   return reply(401,'WORKER_UNAUTHORIZED');
  if(enabled!==true)return reply(503,'WORKER_NOT_ACTIVATED');
  let payload;
  try{
    if(request.headers.get('content-type')!=='application/json')
      return reply(400,'EXACT_REQUEST_REQUIRED');
    const body=await request.text();
    if(body.length>200)return reply(413,'REQUEST_TOO_LARGE');
    payload=JSON.parse(body);
  }catch{return reply(400,'EXACT_REQUEST_REQUIRED');}
  if(!payload||Array.isArray(payload)||Object.keys(payload).length!==1
    ||payload.operation!=='preallocate')return reply(400,'EXACT_REQUEST_REQUIRED');
  if(!expectedAccount||!expectedDriveId||!oauthScope||!supabaseUrl
     ||!serviceRoleJwt||!clientId||!clientSecret||!refreshToken)
    return reply(503,'BACKEND_NOT_CONFIGURED');
  try{
    const tokenProvider=createWorkspaceTokenProvider({
      clientId,clientSecret,refreshToken,requiredScope:oauthScope,fetcher});
    const ledger=createServiceLedger({url:supabaseUrl,serviceRoleJwt,fetcher});
    const result=await prepareTrustedDelivery({
      tokenProvider,ledger,workerId:makeWorkerId(),
      expectedEmail:expectedAccount,expectedDriveId,fetcher
    });
    if(result.claimed===false)return reply(200,'NO_ELIGIBLE_PACKAGES');
    if(result.provider_writes_performed!==false)
      return reply(503,'PROVIDER_NOT_READY');
    return reply(200,'PREALLOCATED_ONLY');
  }catch {
    // Never expose a live OAuth token, session URI, Supabase key, package ID
    // or provider error body in responses to callers.
    return reply(503,'TRUSTED_PROVIDER_UNAVAILABLE');
  }
 };
}
