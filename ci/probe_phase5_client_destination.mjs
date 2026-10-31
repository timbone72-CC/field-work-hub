// Operator-private, single TEST-client Phase 5A/D root preflight.
// Google access is GET-only; Supabase records one immutable INACTIVE receipt.
// No hosted endpoint, delivery worker, file create, Send or photo access.
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {constants} from 'node:fs';
import {open,lstat,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServiceLedger} from '../supabase/functions/client-delivery/service-ledger.mjs';
import {createWorkspaceTokenProvider} from '../supabase/functions/client-delivery/workspace-oauth.mjs';
import {preflightInactiveClientDestination} from '../supabase/functions/client-delivery/worker-runtime.mjs';
import {validateProofConfiguration} from './probe_phase5_workspace_folder.mjs';
import {preferIPv4ForLocalWorkspaceBootstrap} from './authorize_phase5_workspace_provider.mjs';

const runCommand=promisify(execFile);
export const PROJECT='vyocaujuwrivoqynvitm';
const BRANCH='feat/phase-5-6-dashboard-workflow';
const REPO='timbone72-CC/field-work-hub';
export const TEST=Object.freeze({
  organizationId:'494154a6-2a7a-4c98-a0a8-2143443fec0e',
  companyId:'8e964c9f-906b-40be-8fa5-e58e3b650596',
  destinationId:'06f157eb-230c-44b5-b3d4-a7508110bfd7'
});
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const HOME=join(homedir(),'.config','field-work-hub');
const JOURNAL=join(HOME,'phase5-client-destination-preflight.json');
const BLOCK='DISPOSABLE_FWH_TEST_ONLY';
const fail=code=>{const e=new Error(code);e.code=code;throw e;};

export function requireExactTestFixture(credential,folder,binding=TEST){
  const conf=validateProofConfiguration(credential);
  const s=folder?.spec;
  if(credential?.FWH_TEST_EVIDENCE_CLASS!==BLOCK
    ||folder?.format!=='FWH_TEST_FOLDER_V1'
    ||folder.drive!==conf.clientDrive||folder.root!==conf.root
    ||s?.parent!==conf.root||s?.mime!=='application/vnd.google-apps.folder'
    ||s?.appProperties?.fwh_kind!=='ADDRESS'
    ||!UUID.test(binding.organizationId??'')
    ||!UUID.test(binding.companyId??'')
    ||!UUID.test(binding.destinationId??''))
    fail('EXACT_PRIVATE_TEST_FIXTURE_REQUIRED');
  return conf;
}
export function verifyPreflightJournal(value,candidate,conf,binding){
  if(value?.format!=='FWH_CLIENT_DESTINATION_PREFLIGHT_V1'
    ||value.destination_id!==binding.destinationId
    ||value.organization_id!==binding.organizationId
    ||value.company_id!==binding.companyId
    ||value.revision!==candidate.revision
    ||value.provider_identity!==conf.email
    ||value.root_folder_id!==conf.root
    ||value.shared_drive_id!==conf.clientDrive
    ||value.internal_drive_id!==conf.internal
    ||!UUID.test(value.action_id??''))
    fail('EXISTING_PREFLIGHT_ACTION_MISMATCH');
}
export async function runClientDestinationPreflight({
  credential,folder,binding=TEST,ledger,tokenProvider,journal,fetcher=fetch,
  makeAction=randomUUID
}={}){
  const conf=requireExactTestFixture(credential,folder,binding);
  if(typeof ledger?.readClientDestination!=='function'
    ||typeof ledger?.recordClientDestinationPreflight!=='function'
    ||typeof tokenProvider!=='function'
    ||typeof journal?.read!=='function'||typeof journal?.reserve!=='function'
    ||typeof fetcher!=='function'||typeof makeAction!=='function')
    fail('TRUSTED_TEST_PREFLIGHT_NOT_CONFIGURED');
  // The service role, not browser or local display text, selects the company.
  const candidate=await ledger.readClientDestination(binding.destinationId);
  if(candidate?.destination_id!==binding.destinationId
    ||candidate.organization_id!==binding.organizationId
    ||candidate.company_id!==binding.companyId
    ||!UUID.test(candidate.revision??'')
    ||candidate.provider!=='GOOGLE_DRIVE'
    ||candidate.provider_identity!==conf.email
    ||candidate.root_folder_id!==conf.root
    ||candidate.verified!==false||candidate.active!==false)
    fail('TEST_DESTINATION_SERVER_BINDING_MISMATCH');
  let saved=await journal.read();
  if(saved===null){
    const action=makeAction();
    if(!UUID.test(action??''))fail('TEST_PREFLIGHT_ACTION_INVALID');
    saved={format:'FWH_CLIENT_DESTINATION_PREFLIGHT_V1',
      action_id:action,destination_id:binding.destinationId,
      organization_id:binding.organizationId,company_id:binding.companyId,
      revision:candidate.revision,provider_identity:conf.email,
      root_folder_id:conf.root,shared_drive_id:conf.clientDrive,
      internal_drive_id:conf.internal};
    // Durable action before service POST; uncertain responses replay this same UUID.
    await journal.reserve(saved);
  }
  verifyPreflightJournal(saved,candidate,conf,binding);
  const result=await preflightInactiveClientDestination({
    ledger,tokenProvider,actionId:saved.action_id,
    destinationId:binding.destinationId,organizationId:binding.organizationId,
    companyId:binding.companyId,expectedEmail:conf.email,
    expectedDriveId:conf.clientDrive,expectedRootId:conf.root,
    internalDriveId:conf.internal,testEvidenceClass:BLOCK,fetcher
  });
  if(result.status!=='CLIENT_DESTINATION_PREFLIGHT_RECORDED'
    ||result.preflight_recorded!==true||result.verified!==false
    ||result.active!==false)
    fail('TEST_PREFLIGHT_RECEIPT_UNVERIFIED');
  return {status:'TEST_CLIENT_DESTINATION_PREFLIGHT_RECORDED',
    active:false,verified:false,replayed:result.replayed};
}
export async function privateJson(path){
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0
    ||st.size<2||st.size>16384
    ||(process.getuid&&st.uid!==process.getuid()))
    fail('PRIVATE_TEST_FILE_REQUIRED');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{return JSON.parse(await fd.readFile('utf8'));}
  finally{await fd.close();}
}
const journal={
  async read(){
    try{return await privateJson(JOURNAL);}
    catch(e){if(e?.code==='ENOENT')return null;throw e;}
  },
  async reserve(value){
    const fd=await open(JOURNAL,'wx',0o600);
    try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}
    finally{await fd.close();}
    const dir=await open(HOME,constants.O_DIRECTORY|constants.O_RDONLY);
    try{await dir.sync();}finally{await dir.close();}
  }
};
export async function command(bin,args){
  try{
    const r=await runCommand(bin,args,{timeout:30000,maxBuffer:1048576,
      encoding:'utf8',windowsHide:true});
    return r.stdout.trim();
  }catch{fail('TRUSTED_OPERATOR_CLI_UNAVAILABLE');}
}
export async function operatorServiceJwt(){
  // The operator's already-authenticated Supabase CLI returns the legacy
  // service_role JWT in memory. Never print, save, embed or ship any key.
  const raw=await command('supabase',['projects','api-keys',
    '--project-ref',PROJECT,'--output','json']);
  let keys;
  try{keys=JSON.parse(raw);}catch{fail('TRUSTED_SERVICE_KEY_UNAVAILABLE');}
  const rows=Array.isArray(keys)?keys:keys?.keys;
  const hits=Array.isArray(rows)?rows.filter(k=>k?.name==='service_role'
    &&typeof k.api_key==='string'):null;
  if(hits?.length!==1||!/^[-_a-zA-Z0-9]{5,}\.[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+$/.test(hits[0].api_key))
    fail('TRUSTED_SERVICE_KEY_UNAVAILABLE');
  return hits[0].api_key;
}
export async function loadTrustedTestOperatorContext(){
  const branch=await command('git',['branch','--show-current']);
  const clean=await command('git',['status','--porcelain']);
  const head=await command('git',['rev-parse','HEAD']);
  const remote=await command('gh',['api','repos/'+REPO+'/pulls/40',
    '--jq','.head.sha']);
  const projectRef=(await readFile('supabase/.temp/project-ref','utf8')).trim();
  if(branch!==BRANCH||clean!==''||head!==remote||projectRef!==PROJECT)
    fail('TEST_REPOSITORY_OR_PROJECT_MISMATCH');
  const dir=await lstat(HOME);
  if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)!==0
    ||(process.getuid&&dir.uid!==process.getuid()))
    fail('PRIVATE_TEST_DIRECTORY_REQUIRED');
  const credential=await privateJson(join(HOME,'workspace-oauth-test.json'));
  const folder=await privateJson(join(HOME,'phase5-disposable-folder-proof.json'));
  requireExactTestFixture(credential,folder,TEST);
  const serviceRoleJwt=await operatorServiceJwt();
  const ledger=createServiceLedger({
    url:'https://'+PROJECT+'.supabase.co',serviceRoleJwt
  });
  const tokenProvider=createWorkspaceTokenProvider({
    clientId:credential.FWH_TEST_WORKSPACE_CLIENT_ID,
    clientSecret:credential.FWH_TEST_WORKSPACE_CLIENT_SECRET,
    refreshToken:credential.FWH_TEST_WORKSPACE_REFRESH_TOKEN,
    requiredScope:credential.FWH_TEST_WORKSPACE_SCOPE
  });
  return {credential,folder,ledger,tokenProvider};
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--record')
    fail('EXACT_TEST_PREFLIGHT_MODE_REQUIRED');
  const {credential,folder,ledger,tokenProvider}=
    await loadTrustedTestOperatorContext();
  const result=await runClientDestinationPreflight({
    credential,folder,ledger,tokenProvider,journal
  });
  process.stdout.write('PASS: '+result.status+
    '. Verified=false, active=false; no Google file write or Send.\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  preferIPv4ForLocalWorkspaceBootstrap();
  main().catch(e=>{
    const codes=new Set(['EXACT_TEST_PREFLIGHT_MODE_REQUIRED',
      'TRUSTED_OPERATOR_CLI_UNAVAILABLE','TRUSTED_SERVICE_KEY_UNAVAILABLE',
      'TEST_REPOSITORY_OR_PROJECT_MISMATCH','PRIVATE_TEST_DIRECTORY_REQUIRED',
      'PRIVATE_TEST_FILE_REQUIRED','EXACT_PRIVATE_TEST_FIXTURE_REQUIRED',
      'TRUSTED_TEST_PREFLIGHT_NOT_CONFIGURED',
      'TEST_DESTINATION_SERVER_BINDING_MISMATCH',
      'TEST_PREFLIGHT_ACTION_INVALID','EXISTING_PREFLIGHT_ACTION_MISMATCH',
      'TEST_PREFLIGHT_RECEIPT_UNVERIFIED',
      'TEST_CLIENT_DESTINATION_SCOPE_MISMATCH',
      'TEST_CLIENT_DESTINATION_PROVIDER_MISMATCH',
      'TEST_CLIENT_DESTINATION_RECEIPT_UNVERIFIED',
      'WORKSPACE_AUTHORIZATION_REQUIRED','SERVICE_RPC_AUTH_DENIED',
      'SERVICE_RPC_OUTCOME_UNCERTAIN','SERVICE_RPC_UNAVAILABLE',
      'PROVIDER_IDENTITY_UNCERTAIN','PROVIDER_AUTH_DENIED',
      'PROVIDER_OUTCOME_UNCERTAIN','PROVIDER_RETRY_REQUIRED']);
    const code=codes.has(e?.code)?e.code:'TEST_CLIENT_PREFLIGHT_UNVERIFIED';
    process.stderr.write('BLOCKED: '+code+
      '. Preserve the original action; do not submit a second proposal.\n');
    process.exitCode=1;
  });
}
