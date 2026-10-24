// One original disposable Google folder proof for the existing FWH TEST client.
// Operator-private only. No delivery worker, client Send, photo, or cleanup.
// --prove-once authorizes at most one reserved create; --reconcile is GET/LIST-only.
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {
  TEST,HOME,privateJson,requireExactTestFixture,verifyPreflightJournal,
  loadTrustedTestOperatorContext
} from './probe_phase5_client_destination.mjs';
import {proveInactiveClientDestinationFolder} from
  '../supabase/functions/client-delivery/worker-runtime.mjs';
import {preferIPv4ForLocalWorkspaceBootstrap} from
  './authorize_phase5_workspace_provider.mjs';

const PREFLIGHT=join(HOME,'phase5-client-destination-preflight.json');
const JOURNAL=join(HOME,'phase5-client-destination-provider-proof.json');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const fail=code=>{const e=new Error(code);e.code=code;throw e;};

export function verifyProviderProofJournal(value,expected){
  if(!value||value.format!=='FWH_CLIENT_PROVIDER_PROOF_V1'
    ||!UUID.test(value.action_id??'')
    ||value.preflight_action_id!==expected.preflightAction
    ||value.destination_id!==expected.binding.destinationId
    ||value.organization_id!==expected.binding.organizationId
    ||value.company_id!==expected.binding.companyId
    ||value.revision!==expected.candidate.revision
    ||value.provider_identity!==expected.conf.email
    ||value.root_folder_id!==expected.conf.root
    ||value.shared_drive_id!==expected.conf.clientDrive
    ||value.internal_drive_id!==expected.conf.internal)
    fail('EXISTING_PROVIDER_PROOF_ACTION_MISMATCH');
}
export async function runClientDestinationProviderProof({
  credential,folder,binding=TEST,ledger,tokenProvider,preflightJournal,
  journal,mode,makeAction=randomUUID,fetcher=fetch,
  prove=proveInactiveClientDestinationFolder
}={}){
  if(!['prove-once','reconcile'].includes(mode)
    ||typeof ledger?.readClientDestination!=='function'
    ||typeof ledger?.readClientDestinationProviderProof!=='function'
    ||typeof tokenProvider!=='function'
    ||typeof preflightJournal?.read!=='function'
    ||typeof journal?.read!=='function'||typeof journal?.reserve!=='function'
    ||typeof makeAction!=='function'||typeof fetcher!=='function'
    ||typeof prove!=='function')
    fail('TEST_CLIENT_PROOF_NOT_CONFIGURED');
  const conf=requireExactTestFixture(credential,folder,binding);
  const candidate=await ledger.readClientDestination(binding.destinationId);
  if(candidate?.destination_id!==binding.destinationId
    ||candidate.organization_id!==binding.organizationId
    ||candidate.company_id!==binding.companyId
    ||!UUID.test(candidate.revision??'')
    ||candidate.provider!=='GOOGLE_DRIVE'
    ||candidate.provider_identity!==conf.email
    ||candidate.root_folder_id!==conf.root
    ||candidate.active!==false)
    fail('TEST_CLIENT_PROOF_SERVER_BINDING_MISMATCH');
  const original=await preflightJournal.read();
  verifyPreflightJournal(original,candidate,conf,binding);
  const preflightAction=original.action_id;
  // Must inspect the original server reservation before allocating any new ID.
  const existing=await ledger.readClientDestinationProviderProof(binding.destinationId);
  if(typeof existing?.exists!=='boolean')
    fail('TEST_CLIENT_PROOF_RESERVATION_UNCERTAIN');
  let saved=await journal.read();
  let createdNow=false;
  if(saved!==null){
    verifyProviderProofJournal(saved,{binding,candidate,conf,preflightAction});
  }else{
    if(existing.exists||mode!=='prove-once'||candidate.verified!==false)
      fail('TEST_CLIENT_PROOF_NOT_AUTHORIZED_OR_UNKNOWN');
    const action=makeAction();
    if(!UUID.test(action??'')||action===preflightAction)
      fail('TEST_CLIENT_PROOF_ACTION_INVALID');
    saved={format:'FWH_CLIENT_PROVIDER_PROOF_V1',
      action_id:action,preflight_action_id:preflightAction,
      destination_id:binding.destinationId,
      organization_id:binding.organizationId,company_id:binding.companyId,
      revision:candidate.revision,provider_identity:conf.email,
      root_folder_id:conf.root,shared_drive_id:conf.clientDrive,
      internal_drive_id:conf.internal};
    // One durable operator action before generateIds, reservation or Google POST.
    await journal.reserve(saved);
    createdNow=true;
  }
  if(candidate.verified!==false&&!(candidate.verified===true
    &&existing.exists&&existing.completed===true))
    fail('TEST_CLIENT_PROOF_DESTINATION_STATE_UNCERTAIN');
  if(existing.exists&&(
    existing.action_id!==saved.action_id
    ||existing.preflight_action_id!==preflightAction
    ||existing.destination_id!==binding.destinationId
    ||existing.organization_id!==binding.organizationId
    ||existing.company_id!==binding.companyId
    ||existing.revision!==candidate.revision
    ||existing.provider_identity!==conf.email
    ||existing.root_folder_id!==conf.root
    ||existing.drive_id!==conf.clientDrive))
    fail('TEST_CLIENT_PROOF_RESERVATION_MISMATCH');
  // Missing remote reservation after an earlier attempt is UNCERTAIN; a
  // second run cannot generate another file ID or try a replacement POST.
  if(!existing.exists&&!createdNow)
    fail('TEST_CLIENT_PROOF_NO_RESERVATION');
  const result=await prove({
    ledger,tokenProvider,actionId:saved.action_id,
    preflightActionId:preflightAction,destinationId:binding.destinationId,
    organizationId:binding.organizationId,companyId:binding.companyId,
    expectedEmail:conf.email,expectedDriveId:conf.clientDrive,
    expectedRootId:conf.root,internalDriveId:conf.internal,
    testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
    allowProviderCreate:mode==='prove-once'&&createdNow,
    fetcher
  });
  if(result?.status!=='CLIENT_DESTINATION_VERIFIED_INACTIVE'
    ||result.destination_id!==binding.destinationId
    ||result.company_id!==binding.companyId
    ||result.verified!==true||result.active!==false
    ||typeof result.replayed!=='boolean'
    ||typeof result.provider_writes_performed!=='boolean')
    fail('TEST_CLIENT_PROOF_RECEIPT_UNVERIFIED');
  return {status:'TEST_CLIENT_DESTINATION_VERIFIED_INACTIVE',
    verified:true,active:false,replayed:result.replayed,
    provider_writes_performed:result.provider_writes_performed};
}
const localJournal=path=>({
  async read(){
    try{return await privateJson(path);}
    catch(e){if(e?.code==='ENOENT')return null;throw e;}
  },
  async reserve(value){
    const fd=await open(path,'wx',0o600);
    try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}
    finally{await fd.close();}
    const dir=await open(HOME,constants.O_RDONLY|constants.O_DIRECTORY);
    try{await dir.sync();}finally{await dir.close();}
  }
});
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==1||!['--prove-once','--reconcile'].includes(args[0]))
    fail('TEST_PROOF_EXPLICIT_MODE_REQUIRED');
  const {credential,folder,ledger,tokenProvider}=
    await loadTrustedTestOperatorContext();
  const result=await runClientDestinationProviderProof({
    credential,folder,ledger,tokenProvider,
    mode:args[0]==='--prove-once'?'prove-once':'reconcile',
    preflightJournal:localJournal(PREFLIGHT),journal:localJournal(JOURNAL)
  });
  process.stdout.write('PASS: '+result.status+
    '. Verified=true, active=false; TEST folder only, no photos or Send.\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  preferIPv4ForLocalWorkspaceBootstrap();
  main().catch(error=>{
    const codes=new Set([
      'TEST_PROOF_EXPLICIT_MODE_REQUIRED','TEST_CLIENT_PROOF_NOT_CONFIGURED',
      'TEST_CLIENT_PROOF_SERVER_BINDING_MISMATCH',
      'EXISTING_PREFLIGHT_ACTION_MISMATCH',
      'EXISTING_PROVIDER_PROOF_ACTION_MISMATCH',
      'TEST_CLIENT_PROOF_RESERVATION_UNCERTAIN',
      'TEST_CLIENT_PROOF_NOT_AUTHORIZED_OR_UNKNOWN',
      'TEST_CLIENT_PROOF_ACTION_INVALID',
      'TEST_CLIENT_PROOF_DESTINATION_STATE_UNCERTAIN',
      'TEST_CLIENT_PROOF_RESERVATION_MISMATCH',
      'TEST_CLIENT_PROOF_NO_RESERVATION',
      'TEST_CLIENT_PROOF_RECEIPT_UNVERIFIED',
      'CLIENT_PROOF_CREATION_NOT_AUTHORIZED',
      'CLIENT_PROOF_RESERVATION_UNCERTAIN',
      'CLIENT_PROOF_RESERVATION_MISMATCH',
      'CLIENT_PROOF_ROOT_PREFLIGHT_UNVERIFIED',
      'CLIENT_PROOF_SCOPE_MISMATCH',
      'CLIENT_PROOF_NEW_ID_INVALID',
      'CLIENT_PROOF_REMOTE_IDENTITY_UNVERIFIED',
      'CLIENT_PROOF_REMOTE_LIST_UNVERIFIED',
      'CLIENT_PROOF_RECEIPT_UNVERIFIED',
      'WORKSPACE_AUTHORIZATION_REQUIRED',
      'TEST_REPOSITORY_OR_PROJECT_MISMATCH',
      'TRUSTED_SERVICE_KEY_UNAVAILABLE','TRUSTED_OPERATOR_CLI_UNAVAILABLE'
    ]);
    process.stderr.write('BLOCKED: '+
      (codes.has(error?.code)?error.code:'TEST_CLIENT_PROOF_UNVERIFIED')+
      '. Preserve all journals and the originally reserved Google ID.\n');
    process.exitCode=1;
  });
}
