// Read-only Phase 5 TEST deployment adapter for the existing client-delivery
// function slug. Do NOT deploy the production preallocation/upload entrypoint
// for this narrow operator-approved provider verification gate.
// Imports only the existing trusted OAuth and Google Drive GET owners.
import {createWorkspaceTokenProvider} from './workspace-oauth.mjs';
import {createDriveClient} from './drive-client.mjs';

function reply(status,code){
  return new Response(JSON.stringify({status:code}),{status,headers:{
    'Content-Type':'application/json','Cache-Control':'no-store, private'
  }});
}
function sameSecret(x,y){
  if(typeof x!=='string'||typeof y!=='string'||!x||!y)return false;
  const a=new TextEncoder().encode(x),b=new TextEncoder().encode(y);
  let difference=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)
    difference|=(a[i]??0)^(b[i]??0);
  return difference===0;
}
const ID=/^[A-Za-z0-9_-]{10,160}$/;
const DOMAIN=/^[a-z0-9.-]+\.[a-z]{2,}$/;

export function createReadOnlyTestHandler({
  deliveryActive=false,testEnabled=false,testEvidenceClass='',
  workerSecret='',expectedEmail='',expectedDriveId='',clientRootId='',
  internalDriveId='',workspaceDomain='',clientId='',clientSecret='',
  refreshToken='',oauthScope='',fetcher=fetch
}={}){
  return async request=>{
    if(request.method!=='POST')return reply(405,'POST_ONLY');
    if(workerSecret.length<32||!sameSecret(request.headers.get('x-fwh-delivery-secret'),workerSecret))
      return reply(401,'WORKER_UNAUTHORIZED');
    // Explicitly no code path for service RPCs, Send, photo reads, Drive writes,
    // permissions, scheduler, or even the full worker's preallocate operation.
    if(deliveryActive!==false||testEnabled!==true)
      return reply(503,'TEST_PREFLIGHT_NOT_ENABLED');
    if(request.headers.get('content-type')!=='application/json')
      return reply(400,'EXACT_REQUEST_REQUIRED');
    let body;
    try{
      const raw=await request.text();
      if(raw.length>200)return reply(413,'REQUEST_TOO_LARGE');
      body=JSON.parse(raw);
    }catch{return reply(400,'EXACT_REQUEST_REQUIRED');}
    if(!body||Array.isArray(body)||Object.keys(body).length!==1
       ||body.operation!=='verify_test_connection')
      return reply(400,'EXACT_REQUEST_REQUIRED');
    if(testEvidenceClass!=='DISPOSABLE_FWH_TEST_ONLY'
      ||!ID.test(clientRootId)||!ID.test(expectedDriveId)
      ||!ID.test(internalDriveId)
      ||clientRootId===expectedDriveId||clientRootId===internalDriveId
      ||expectedDriveId===internalDriveId
      ||!DOMAIN.test(workspaceDomain)
      ||typeof expectedEmail!=='string'
      ||expectedEmail.toLowerCase().split('@')[1]!==workspaceDomain
      ||!clientId||!clientSecret||!refreshToken
      ||!['https://www.googleapis.com/auth/drive','https://www.googleapis.com/auth/drive.file'].includes(oauthScope))
      return reply(503,'TEST_PROVIDER_NOT_CONFIGURED');
    try{
      const getToken=createWorkspaceTokenProvider({
        clientId,clientSecret,refreshToken,requiredScope:oauthScope,fetcher
      });
      const auth=await getToken();
      const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
      await drive.verifyProviderIdentity(expectedEmail);
      const root=await drive.verifyDestination({
        folderId:clientRootId,expectedDriveId
      });
      if(root.id!==clientRootId||root.drive_id!==expectedDriveId
        ||root.can_add_children!==true)
        return reply(503,'TEST_PROVIDER_UNAVAILABLE');
      return reply(200,'TEST_PROVIDER_VERIFIED_READ_ONLY');
    }catch{
      return reply(503,'TEST_PROVIDER_UNAVAILABLE');
    }
  };
}
