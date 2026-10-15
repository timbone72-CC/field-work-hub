// PRIVATE backend-only, intentionally inactive until real provider evidence.
// No browser CORS. No file writes, photo deletion, scheduler or client Send.
// Real OAuth and destination must pass provider gate before ACTIVE may be true.
import {createWorkspaceTokenProvider} from './workspace-oauth.mjs';
import {createDriveClient} from './drive-client.mjs';
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
  testPreflightEnabled=false,testEvidenceClass,testRootFolderId,internalDriveId,
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
  // Separate read-only TEST credential probe may run while Send is OFF.
  // No provider work is permitted when both capabilities are disabled.
  if(enabled!==true&&testPreflightEnabled!==true)
    return reply(503,'WORKER_NOT_ACTIVATED');
  let payload;
  try{
    if(request.headers.get('content-type')!=='application/json')
      return reply(400,'EXACT_REQUEST_REQUIRED');
    const body=await request.text();
    if(body.length>200)return reply(413,'REQUEST_TOO_LARGE');
    payload=JSON.parse(body);
  }catch{return reply(400,'EXACT_REQUEST_REQUIRED');}
  if(!payload||Array.isArray(payload)||Object.keys(payload).length!==1
    ||!['preallocate','verify_test_connection'].includes(payload.operation))
    return reply(400,'EXACT_REQUEST_REQUIRED');
  if(payload.operation==='verify_test_connection'){
    // TEST probe and delivery must never be active together. The operator
    // controls TEST-only roots in trusted server environment, not payload.
    if(testPreflightEnabled!==true||enabled===true)
      return reply(503,'TEST_PREFLIGHT_NOT_ENABLED');
    const id=/^[A-Za-z0-9_-]{10,160}$/;
    if(testEvidenceClass!=='DISPOSABLE_FWH_TEST_ONLY'
      ||!id.test(testRootFolderId??'')||!id.test(expectedDriveId??'')
      ||!id.test(internalDriveId??'')
      ||testRootFolderId===expectedDriveId
      ||internalDriveId===expectedDriveId
      ||testRootFolderId===internalDriveId
      ||typeof expectedAccount!=='string'
      ||!expectedAccount.toLowerCase().endsWith('@inandoutinspectionsllc.com')
      ||!clientId||!clientSecret||!refreshToken||!oauthScope)
      return reply(503,'TEST_PROVIDER_NOT_CONFIGURED');
    try{
      const tokenProvider=createWorkspaceTokenProvider({
        clientId,clientSecret,refreshToken,requiredScope:oauthScope,fetcher});
      const auth=await tokenProvider();
      const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
      await drive.verifyProviderIdentity(expectedAccount);
      const folder=await drive.verifyDestination({
        folderId:testRootFolderId,expectedDriveId
      });
      if(folder.id!==testRootFolderId||folder.drive_id!==expectedDriveId
        ||folder.can_add_children!==true)throw Error('TEST_ROOT_NOT_VERIFIED');
      return reply(200,'TEST_PROVIDER_VERIFIED_READ_ONLY');
    }catch{
      // Never emit provider/token error details or configured object identity.
      return reply(503,'TEST_PROVIDER_UNAVAILABLE');
    }
  }
  if(enabled!==true)return reply(503,'WORKER_NOT_ACTIVATED');
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
