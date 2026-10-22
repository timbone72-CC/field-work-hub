// Read-only Phase 5 TEST deployment adapter for the existing client-delivery
// function slug. Do NOT deploy the production preallocation/upload entrypoint
// for this narrow operator-approved provider verification gate.
// Imports only the existing trusted OAuth and Google Drive GET owners.
import {createWorkspaceTokenProvider} from './workspace-oauth.mjs';
import {createDriveClient} from './drive-client.mjs';
import {createSessionVault} from './session-vault.mjs';

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
  refreshToken='',oauthScope='',sessionVaultKey='',fetcher=fetch
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
       ||!['verify_test_connection','verify_test_worker_config'].includes(body.operation))
      return reply(400,'EXACT_REQUEST_REQUIRED');
    // Authenticated diagnostics disclose only the *names* of invalid host
    // configuration keys. Never echo provider IDs, emails, credential values,
    // lengths, token hashes, user-supplied fields, or Google error messages.
    const invalid=[];
    const requireConfig=(name,failed)=>{if(failed)invalid.push(name);};
    requireConfig('FWH_TEST_EVIDENCE_CLASS',testEvidenceClass!=='DISPOSABLE_FWH_TEST_ONLY');
    requireConfig('FWH_CLIENT_TEST_ROOT_FOLDER_ID',!ID.test(clientRootId)
      ||clientRootId===expectedDriveId||clientRootId===internalDriveId);
    requireConfig('FWH_CLIENT_SHARED_DRIVE_ID',!ID.test(expectedDriveId)
      ||expectedDriveId===clientRootId||expectedDriveId===internalDriveId);
    requireConfig('FWH_INTERNAL_SHARED_DRIVE_ID',!ID.test(internalDriveId)
      ||internalDriveId===clientRootId||internalDriveId===expectedDriveId);
    requireConfig('FWH_TEST_WORKSPACE_DOMAIN',!DOMAIN.test(workspaceDomain));
    requireConfig('FWH_CLIENT_DRIVE_ACCOUNT',typeof expectedEmail!=='string'
      ||expectedEmail.toLowerCase().split('@')[1]!==workspaceDomain);
    requireConfig('FWH_GOOGLE_OAUTH_CLIENT_ID',!clientId);
    requireConfig('FWH_GOOGLE_OAUTH_CLIENT_SECRET',!clientSecret);
    requireConfig('FWH_GOOGLE_OAUTH_REFRESH_TOKEN',!refreshToken);
    requireConfig('FWH_GOOGLE_OAUTH_SCOPE',
      !['https://www.googleapis.com/auth/drive','https://www.googleapis.com/auth/drive.file'].includes(oauthScope));
    if(invalid.length!==0)
      return new Response(JSON.stringify({status:'TEST_PROVIDER_NOT_CONFIGURED',
        invalid_fields:invalid}),{status:503,headers:{
          'Content-Type':'application/json','Cache-Control':'no-store, private'
        }});
    // Read-only TEST check of the *hosted* AES key's actual crypto usability.
    // Disposable in-memory plaintext and IDs only: no stored Drive session is
    // opened, no remote file or SQL permit is touched, no key material returned.
    if(body.operation==='verify_test_worker_config'){
      try{
        const vault=await createSessionVault({base64Key:sessionVaultKey});
        const disposableUrl='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
        const identity={packageId:'fwh_test_package_identity',fileId:'fwh_test_file_identity'};
        const sealed=await vault.seal(disposableUrl,identity);
        if(await vault.open(sealed,identity)!==disposableUrl)
          return reply(503,'TEST_SESSION_VAULT_UNAVAILABLE');
      }catch{return reply(503,'TEST_SESSION_VAULT_UNAVAILABLE');}
    }
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
      return reply(200,body.operation==='verify_test_worker_config'
        ?'TEST_WORKER_CRYPTO_PROVIDER_READ_ONLY':'TEST_PROVIDER_VERIFIED_READ_ONLY');
    }catch{
      return reply(503,'TEST_PROVIDER_UNAVAILABLE');
    }
  };
}
