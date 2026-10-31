import test from 'node:test';
import assert from 'node:assert/strict';
import {runClientDestinationProviderProof,verifyProviderProofJournal}
  from '../../ci/probe_phase5_client_provider_proof.mjs';
const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const binding={organizationId:u(1),companyId:u(2),destinationId:u(3)};
const revision=u(4),preflightAction=u(5),proofAction=u(6);
const email='test-office@example.org';
const root='FWH_TEST_ROOT_123456789',drive='FWH_TEST_SHARED_DRIVE_123456789';
const internal='FWH_INTERNAL_DRIVE_123456789';
const credential=()=>({
 FWH_TEST_EVIDENCE_CLASS:'DISPOSABLE_FWH_TEST_ONLY',
 FWH_TEST_WORKSPACE_EMAIL:email,FWH_TEST_WORKSPACE_DOMAIN:'example.org',
 FWH_TEST_WORKSPACE_SCOPE:'https://www.googleapis.com/auth/drive',
 FWH_TEST_CLIENT_SHARED_DRIVE_ID:drive,FWH_TEST_INTERNAL_SHARED_DRIVE_ID:internal,
 FWH_TEST_CLIENT_ROOT_FOLDER_ID:root
});
const folder=()=>({format:'FWH_TEST_FOLDER_V1',drive,root,
 spec:{id:'FWH_SAVED_TEST_FOLDER_123',parent:root,
 mime:'application/vnd.google-apps.folder',appProperties:{fwh_kind:'ADDRESS'}}});
const candidate=()=>({destination_id:binding.destinationId,
 organization_id:binding.organizationId,company_id:binding.companyId,
 revision,provider:'GOOGLE_DRIVE',provider_identity:email,
 root_folder_id:root,verified:false,active:false});
const preflight=()=>({format:'FWH_CLIENT_DESTINATION_PREFLIGHT_V1',
 action_id:preflightAction,destination_id:binding.destinationId,
 organization_id:binding.organizationId,company_id:binding.companyId,
 revision,provider_identity:email,root_folder_id:root,
 shared_drive_id:drive,internal_drive_id:internal});
const savedProof=()=>({format:'FWH_CLIENT_PROVIDER_PROOF_V1',
 action_id:proofAction,preflight_action_id:preflightAction,
 destination_id:binding.destinationId,
 organization_id:binding.organizationId,company_id:binding.companyId,
 revision,provider_identity:email,root_folder_id:root,
 shared_drive_id:drive,internal_drive_id:internal});
const existingProof=(completed=false)=>({
 exists:true,completed,action_id:proofAction,
 preflight_action_id:preflightAction,destination_id:binding.destinationId,
 organization_id:binding.organizationId,company_id:binding.companyId,
 revision,provider_identity:email,root_folder_id:root,drive_id:drive
});
function rig({
  server=candidate(),preflightValue=preflight(),proofValue=null,
  saved=null,credentials=credential(),folderValue=folder()
}={}){
 const calls={server:[],reserved:[],prove:[]};
 let journalValue=saved;
 const ledger={
   readClientDestination:async id=>{calls.server.push(['candidate',id]);return server;},
   readClientDestinationProviderProof:async id=>{
     calls.server.push(['proof',id]);return proofValue||{exists:false};}
 };
 const journal={
   async read(){return journalValue;},
   async reserve(value){assert.equal(journalValue,null);
     calls.reserved.push(value);journalValue=value;}
 };
 const preflightJournal={async read(){return preflightValue;}};
 const prove=async options=>{
   calls.prove.push(options);
   return {status:'CLIENT_DESTINATION_VERIFIED_INACTIVE',
     destination_id:binding.destinationId,company_id:binding.companyId,
     verified:true,active:false,replayed:!options.allowProviderCreate,
     provider_writes_performed:options.allowProviderCreate};
 };
 const config={binding,credential:credentials,folder:folderValue,ledger,
   tokenProvider:async()=>({accessToken:'valid-private-token',expiresInSeconds:3600}),
   preflightJournal,journal,makeAction:()=>proofAction,mode:'prove-once',
   prove,fetcher:async()=>{throw Error('stub should own provider I/O');}};
 return {config,calls,read:()=>journalValue};
}
test('one explicitly requested TEST proof freezes action before one permitted creation',async()=>{
 const r=rig();
 const result=await runClientDestinationProviderProof(r.config);
 assert.equal(result.status,'TEST_CLIENT_DESTINATION_VERIFIED_INACTIVE');
 assert.equal(result.verified,true);assert.equal(result.active,false);
 assert.equal(result.provider_writes_performed,true);
 assert.equal(r.calls.reserved.length,1);
 assert.equal(r.calls.reserved[0].action_id,proofAction);
 assert.equal(r.calls.prove.length,1);
 assert.equal(r.calls.prove[0].allowProviderCreate,true);
 assert.equal(r.calls.prove[0].preflightActionId,preflightAction);
 assert.equal(r.calls.prove[0].expectedRootId,root);
 assert.equal(r.calls.prove[0].expectedDriveId,drive);
});
test('saved reservation only reconciles original ID, even with --prove-once',async()=>{
 for(const mode of ['prove-once','reconcile']){
   const r=rig({saved:savedProof(),proofValue:existingProof()});
   const got=await runClientDestinationProviderProof({...r.config,mode});
   assert.equal(got.verified,true);
   assert.equal(got.provider_writes_performed,false);
   assert.equal(r.calls.reserved.length,0);
   assert.equal(r.calls.prove.length,1);
   assert.equal(r.calls.prove[0].allowProviderCreate,false);
 }
});
test('original receipt replay stays inactive and cannot create a second folder',async()=>{
 const r=rig({saved:savedProof(),proofValue:existingProof(true),
   server:{...candidate(),verified:true}});
 const got=await runClientDestinationProviderProof(r.config);
 assert.equal(got.active,false);assert.equal(got.replayed,true);
 assert.equal(r.calls.prove[0].allowProviderCreate,false);
});
test('no --prove-once, no durable new action or provider create',async()=>{
 const r=rig();
 await assert.rejects(()=>runClientDestinationProviderProof({...r.config,mode:'reconcile'}),
   e=>e.code==='TEST_CLIENT_PROOF_NOT_AUTHORIZED_OR_UNKNOWN');
 assert.equal(r.calls.prove.length,0);assert.equal(r.calls.reserved.length,0);
});
test('lost/ambiguous reservation cannot generate a second Drive file ID',async()=>{
 const r=rig({saved:savedProof(),proofValue:{exists:false}});
 await assert.rejects(()=>runClientDestinationProviderProof(r.config),
   e=>e.code==='TEST_CLIENT_PROOF_NO_RESERVATION');
 assert.equal(r.calls.prove.length,0);
 assert.equal(r.calls.reserved.length,0);
});
test('remote reservation without local original proof action is held for reconciliation',async()=>{
 const r=rig({proofValue:existingProof()});
 await assert.rejects(()=>runClientDestinationProviderProof(r.config),
   e=>e.code==='TEST_CLIENT_PROOF_NOT_AUTHORIZED_OR_UNKNOWN');
 assert.equal(r.calls.prove.length,0);assert.equal(r.calls.reserved.length,0);
});
test('mismatched server company/root/revision and preflight stop before creating anything',async()=>{
 for(const opt of [
   {server:{...candidate(),company_id:u(99)}},
   {server:{...candidate(),organization_id:u(98)}},
   {server:{...candidate(),root_folder_id:'wrong_saved_root_1234567'}},
   {server:{...candidate(),provider_identity:'wrong@example.org'}},
   {server:{...candidate(),revision:'invalid'}},
   {server:{...candidate(),active:true}},
   {preflightValue:{...preflight(),revision:u(97)}},
   {preflightValue:{...preflight(),action_id:'nope'}}
 ]){
   const r=rig(opt);
   await assert.rejects(()=>runClientDestinationProviderProof(r.config));
   assert.equal(r.calls.prove.length,0);assert.equal(r.calls.reserved.length,0);
 }
});
test('cross-Drive/non-TEST inputs fail before reading private server proof',async()=>{
 for(const opt of [
   {credentials:{...credential(),FWH_TEST_EVIDENCE_CLASS:'LIVE'}},
   {credentials:{...credential(),FWH_TEST_CLIENT_SHARED_DRIVE_ID:internal}},
   {folderValue:{...folder(),root:internal}},
   {folderValue:{...folder(),spec:{...folder().spec,parent:internal}}}
 ]){
   const r=rig(opt);
   await assert.rejects(()=>runClientDestinationProviderProof(r.config));
   assert.equal(r.calls.server.length,0);
   assert.equal(r.calls.prove.length,0);assert.equal(r.calls.reserved.length,0);
 }
});
test('mismatched saved proof journal, including action or Drive, is fail-closed',async()=>{
 for(const bad of [
   {...savedProof(),preflight_action_id:u(71)},
   {...savedProof(),revision:u(72)},
   {...savedProof(),shared_drive_id:internal},
   {...savedProof(),action_id:'not-valid'},
   {...savedProof(),company_id:u(73)}
 ]){
   const r=rig({saved:bad,proofValue:existingProof()});
   await assert.rejects(()=>runClientDestinationProviderProof(r.config),
     e=>e.code==='EXISTING_PROVIDER_PROOF_ACTION_MISMATCH');
   assert.equal(r.calls.prove.length,0);
 }
 assert.doesNotThrow(()=>verifyProviderProofJournal(savedProof(),{
   binding,candidate:candidate(),
   conf:{email,root,clientDrive:drive,internal},
   preflightAction}));
});
test('a different remote reservation action or company never authorizes GET/list or create',async()=>{
 for(const change of [{action_id:u(80)},{company_id:u(81)},
    {drive_id:internal},{revision:u(82)}]){
   const r=rig({saved:savedProof(),proofValue:{...existingProof(),...change}});
   await assert.rejects(()=>runClientDestinationProviderProof(r.config),
     e=>e.code==='TEST_CLIENT_PROOF_RESERVATION_MISMATCH');
   assert.equal(r.calls.prove.length,0);
 }
});
