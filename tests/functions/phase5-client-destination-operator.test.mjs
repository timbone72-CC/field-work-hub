import test from 'node:test';
import assert from 'node:assert/strict';
import {runClientDestinationPreflight,requireExactTestFixture,
  verifyPreflightJournal} from '../../ci/probe_phase5_client_destination.mjs';

const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const binding={organizationId:u(1),companyId:u(2),destinationId:u(3)};
const revision=u(4),action=u(5);
const root='FWH_TEST_ROOT_123456789',drive='FWH_TEST_SHARED_DRIVE_123456789';
const internal='FWH_INTERNAL_DRIVE_123456789',email='test-office@example.org';
const fixture=()=>({
  FWH_TEST_EVIDENCE_CLASS:'DISPOSABLE_FWH_TEST_ONLY',
  FWH_TEST_WORKSPACE_EMAIL:email,FWH_TEST_WORKSPACE_DOMAIN:'example.org',
  FWH_TEST_WORKSPACE_SCOPE:'https://www.googleapis.com/auth/drive',
  FWH_TEST_CLIENT_SHARED_DRIVE_ID:drive,FWH_TEST_INTERNAL_SHARED_DRIVE_ID:internal,
  FWH_TEST_CLIENT_ROOT_FOLDER_ID:root
});
const folder=()=>({format:'FWH_TEST_FOLDER_V1',drive,root,
  spec:{id:'FWH_SAVED_TEST_PROOF_FOLDER_123',parent:root,
    mime:'application/vnd.google-apps.folder',
    appProperties:{fwh_kind:'ADDRESS'}}});
const candidate=()=>({destination_id:binding.destinationId,
  organization_id:binding.organizationId,company_id:binding.companyId,
  revision,provider:'GOOGLE_DRIVE',provider_identity:email,
  root_folder_id:root,verified:false,active:false});
function rig({server=candidate(),providerEmail=email,providerDrive=drive,
  receiptError=false,stored=null,credential=fixture(),folderRecord=folder()}={}){
  const calls={reads:[],writes:[],google:[],saved:[],};
  let durable=stored;
  const ledger={
    readClientDestination:async id=>{calls.reads.push(id);return server;},
    recordClientDestinationPreflight:async(a,c,d)=>{
      calls.writes.push({action:a,candidate:c,drive:d});
      if(receiptError)throw Error('network result uncertain');
      return {destination_id:binding.destinationId,company_id:binding.companyId,
        preflight_recorded:true,verified:false,active:false,
        replayed:calls.writes.length>1};
    }
  };
  const fetcher=async(url,options={})=>{
    const request={url:String(url),method:options.method||'GET'};
    calls.google.push(request);
    assert.equal(request.method,'GET','preflight cannot create Google objects');
    if(request.url.includes('/drive/v3/about'))
      return new Response(JSON.stringify({user:{emailAddress:providerEmail,
        permissionId:'trusted-test',me:true}}),{
        status:200,headers:{'Content-Type':'application/json'}});
    assert.ok(request.url.includes('/drive/v3/files/'));
    return new Response(JSON.stringify({id:root,driveId:providerDrive,
      mimeType:'application/vnd.google-apps.folder',trashed:false,
      capabilities:{canAddChildren:true}}),{
      status:200,headers:{'Content-Type':'application/json'}});
  };
  const journal={
    async read(){return durable;},
    async reserve(value){assert.equal(durable,null);durable=value;
      calls.saved.push(value);}
  };
  const config={binding,credential,folder:folderRecord,ledger,journal,fetcher,
    tokenProvider:async()=>({accessToken:'private_TEST_provider_token_1234567890',
      expiresInSeconds:3600}),makeAction:()=>action};
  return {config,calls,readJournal:()=>durable};
}
test('operator TEST runner binds server org/company/revision and exact private root before recording',async()=>{
  const r=rig();
  const got=await runClientDestinationPreflight(r.config);
  assert.deepEqual(got,{status:'TEST_CLIENT_DESTINATION_PREFLIGHT_RECORDED',
    active:false,verified:false,replayed:false});
  assert.equal(r.calls.saved.length,1);
  assert.equal(r.calls.saved[0].action_id,action);
  assert.equal(r.calls.writes.length,1);
  assert.equal(r.calls.writes[0].action,action);
  assert.equal(r.calls.writes[0].candidate.root_folder_id,root);
  assert.equal(r.calls.google.length,2);
  assert.deepEqual(r.calls.google.map(x=>x.method),['GET','GET']);
});
test('same exact TEST action is reused on repeat; no alternate proposal or Drive POST',async()=>{
  const r=rig();
  await runClientDestinationPreflight(r.config);
  const got=await runClientDestinationPreflight(r.config);
  assert.equal(got.replayed,true);
  assert.equal(r.calls.saved.length,1);
  assert.deepEqual(r.calls.writes.map(x=>x.action),[action,action]);
  assert.equal(r.calls.google.every(x=>x.method==='GET'),true);
});
test('lost receipt response preserves one durable action for exact replay',async()=>{
  let failed=true;
  const r=rig();
  const realRecord=r.config.ledger.recordClientDestinationPreflight;
  r.config.ledger.recordClientDestinationPreflight=async(...args)=>{
    if(failed){failed=false;throw Error('lost response');}
    return realRecord(...args);
  };
  await assert.rejects(()=>runClientDestinationPreflight(r.config));
  assert.equal(r.calls.saved.length,1);
  assert.equal((await runClientDestinationPreflight(r.config)).verified,false);
  assert.equal(r.calls.saved.length,1);
  assert.equal(r.readJournal().action_id,action);
});
test('wrong company, revision, account or root stops before journal/Google POST',async()=>{
  for(const server of [
    {...candidate(),organization_id:u(51)},
    {...candidate(),company_id:u(52)},
    {...candidate(),provider_identity:'other@example.org'},
    {...candidate(),root_folder_id:'wrong_test_root_12345'},
    {...candidate(),verified:true},
    {...candidate(),active:true},
    {...candidate(),revision:'not-a-uuid'}
  ]){
    const r=rig({server});
    await assert.rejects(()=>runClientDestinationPreflight(r.config),
      e=>e.code==='TEST_DESTINATION_SERVER_BINDING_MISMATCH');
    assert.equal(r.calls.saved.length,0);
    assert.equal(r.calls.writes.length,0);
    assert.equal(r.calls.google.length,0);
  }
});
test('cross-Drive private fixture or non-TEST class denied before any provider request',async()=>{
  for(const options of [
    {credential:{...fixture(),FWH_TEST_EVIDENCE_CLASS:'LIVE'}},
    {folderRecord:{...folder(),drive:internal}},
    {folderRecord:{...folder(),spec:{...folder().spec,parent:internal}}},
    {credential:{...fixture(),FWH_TEST_CLIENT_ROOT_FOLDER_ID:internal}}
  ]){
    const r=rig(options);
    await assert.rejects(()=>runClientDestinationPreflight(r.config));
    assert.equal(r.calls.reads.length,0);
    assert.equal(r.calls.google.length,0);
    assert.equal(r.calls.writes.length,0);
  }
});
test('existing mismatched action/revision/Drive fails closed without Google or service write',async()=>{
  const r=rig();
  await runClientDestinationPreflight(r.config);
  const saved=r.readJournal();
  for(const wrong of [
    {...saved,revision:u(89)},{...saved,shared_drive_id:internal},
    {...saved,action_id:'not-a-uuid'}, {...saved,company_id:u(90)}
  ]){
    const x=rig({stored:wrong});
    await assert.rejects(()=>runClientDestinationPreflight(x.config),
      e=>e.code==='EXISTING_PREFLIGHT_ACTION_MISMATCH');
    assert.equal(x.calls.writes.length,0);assert.equal(x.calls.google.length,0);
  }
  assert.doesNotThrow(()=>verifyPreflightJournal(saved,candidate(),
    requireExactTestFixture(fixture(),folder(),binding),binding));
});
test('provider wrong account or Drive cannot record a preflight receipt',async()=>{
  for(const options of [
    {providerEmail:'wrong@example.org'},
    {providerDrive:internal}
  ]){
    const r=rig(options);
    await assert.rejects(()=>runClientDestinationPreflight(r.config));
    assert.equal(r.calls.writes.length,0);
    assert.equal(r.calls.google.length,2);
    assert.equal(r.calls.saved.length,1);
  }
});
