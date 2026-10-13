// TEST-only, read-only Workspace OAuth and exact client destination preflight.
// Never receives a browser JWT, writes a Drive object, or activates Send.
// Values below come ONLY from locally protected environment variables.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createWorkspaceTokenProvider} from '../supabase/functions/client-delivery/workspace-oauth.mjs';
import {createDriveClient} from '../supabase/functions/client-delivery/drive-client.mjs';

const ID=/^[A-Za-z0-9_-]{10,160}$/;
const EMAIL=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const DOMAIN=/^[a-z0-9.-]+\.[a-z]{2,}$/i;
export class ProviderPreflightBlocked extends Error {
  constructor(code){super(code);this.name='ProviderPreflightBlocked';this.code=code;}
}
const deny=code=>{throw new ProviderPreflightBlocked(code);};
export async function verifyPhase5WorkspaceProvider({env=process.env,fetcher=fetch}={}){
  if(env.FWH_TEST_EVIDENCE_CLASS!=='DISPOSABLE_FWH_TEST_ONLY')
    deny('TEST_ONLY_EVIDENCE_REQUIRED');
  const email=env.FWH_TEST_WORKSPACE_EMAIL?.toLowerCase().trim();
  const domain=env.FWH_TEST_WORKSPACE_DOMAIN?.toLowerCase().trim();
  const internal=env.FWH_TEST_INTERNAL_SHARED_DRIVE_ID;
  const clientDrive=env.FWH_TEST_CLIENT_SHARED_DRIVE_ID;
  const clientRoot=env.FWH_TEST_CLIENT_ROOT_FOLDER_ID;
  if(!EMAIL.test(email??'')||!DOMAIN.test(domain??'')
    ||email.split('@')[1]!==domain)
    deny('EXACT_WORKSPACE_ACCOUNT_REQUIRED');
  if(!ID.test(internal??'')||!ID.test(clientDrive??'')||!ID.test(clientRoot??'')
    ||internal===clientDrive||clientRoot===internal||clientRoot===clientDrive)
    deny('DISTINCT_TEST_CLIENT_DESTINATION_REQUIRED');
  if(typeof fetcher!=='function')deny('FIXED_PROVIDER_TRANSPORT_REQUIRED');
  // The only POST here is a token refresh to Google's fixed OAuth endpoint.
  // The existing Drive adapter issues GETs for about.get and files.get.
  // No create, grant, list, upload, schedule, or runtime-ready mutation.
  const refresh=createWorkspaceTokenProvider({
    clientId:env.FWH_TEST_WORKSPACE_CLIENT_ID,
    clientSecret:env.FWH_TEST_WORKSPACE_CLIENT_SECRET,
    refreshToken:env.FWH_TEST_WORKSPACE_REFRESH_TOKEN,
    requiredScope:env.FWH_TEST_WORKSPACE_SCOPE,fetcher
  });
  const auth=await refresh();
  const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
  await drive.verifyProviderIdentity(email);
  const dest=await drive.verifyDestination({
    folderId:clientRoot,expectedDriveId:clientDrive
  });
  if(dest.id!==clientRoot||dest.drive_id!==clientDrive||dest.can_add_children!==true)
    deny('EXACT_TEST_CLIENT_DESTINATION_UNVERIFIED');
  // Intentionally return no account name, provider ID, URL or token.
  return Object.freeze({
    test_only:true,account_verified:true,client_root_writable:true,
    separate_from_internal_drive:true,provider_writes_performed:false,
    worker_activated:false
  });
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  verifyPhase5WorkspaceProvider().then(()=>{
    process.stdout.write('PASS: TEST Workspace identity and separate writable client root. No Drive writes or Send.\\n');
  }).catch(error=>{
    // No caller-controlled message, backend credential, Drive URL or token.
    const allow=new Set(['TEST_ONLY_EVIDENCE_REQUIRED','EXACT_WORKSPACE_ACCOUNT_REQUIRED',
      'DISTINCT_TEST_CLIENT_DESTINATION_REQUIRED','FIXED_PROVIDER_TRANSPORT_REQUIRED',
      'BACKEND_OAUTH_NOT_CONFIGURED','WORKSPACE_AUTHORIZATION_REQUIRED',
      'OAUTH_SCOPE_OR_TOKEN_INVALID','OAUTH_OUTCOME_UNCERTAIN','OAUTH_UNAVAILABLE',
      'SERVER_OAUTH_TOKEN_REQUIRED','WORKSPACE_ACCOUNT_MISMATCH',
      'DESTINATION_NOT_VERIFIED','DESTINATION_ID_REQUIRED','PROVIDER_AUTH_DENIED',
      'PROVIDER_IDENTITY_UNCERTAIN','PROVIDER_RETRY_REQUIRED','PROVIDER_OUTCOME_UNCERTAIN',
      'PROVIDER_RESPONSE_UNCERTAIN','EXACT_TEST_CLIENT_DESTINATION_UNVERIFIED']);
    process.stderr.write('BLOCKED: '+(allow.has(error?.code)?error.code:'PROVIDER_PREFLIGHT_UNCERTAIN')+'\\n');
    process.exitCode=1;
  });
}
