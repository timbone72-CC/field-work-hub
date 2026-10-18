import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightInactiveClientDestination as preflight}
 from '../../supabase/functions/client-delivery/worker-runtime.mjs';
import {createServiceLedger}
 from '../../supabase/functions/client-delivery/service-ledger.mjs';

const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=u(1),company=u(2),destination=u(3),revision=u(4),action=u(5);
const root='FWH_TEST_ROOT_123456789',drive='FWH_TEST_SHARED_DRIVE_123456789';
const internal='FWH_INTERNAL_DRIVE_123456789',account='test-office@example.org';
const url='https://vyocaujuwrivoqynvitm.supabase.co';
const candidate=()=>({organization_id:org,company_id:company,
 destination_id:destination,revision,provider:'GOOGLE_DRIVE',
 provider_identity:account,root_folder_id:root,verified:false,active:false});
const receipt=()=>({destination_id:destination,company_id:company,
 preflight_recorded:true,verified:false,active:false,replayed:false});
function rig({candidateValue=candidate(),receiptValue=receipt(),
 providerEmail=account,providerDrive=drive,canAddChildren=true,
 providerStatus=200,failToken=false}={}){
  const calls={google:[],read:[],write:[]};
  const ledger={
    readClientDestination:async id=>{calls.read.push(id);return candidateValue;},
    recordClientDestinationPreflight:async (...a)=>{calls.write.push(a);return receiptValue;}
  };
  const fetcher=async (input,options)=>{
    const req={url:String(input),method:options?.method??'GET'};
    calls.google.push(req);
    assert.equal(req.method,'GET','no Drive file writes');
    if(req.url.includes('/drive/v3/about'))
      return new Response(JSON.stringify({user:{
        emailAddress:providerEmail,permissionId:'provider-test-only',me:true
      }}),{status:providerStatus,headers:{'Content-Type':'application/json'}});
    assert.ok(req.url.includes('/drive/v3/files/'));
    assert.ok(req.url.includes(encodeURIComponent(root)));
    return new Response(JSON.stringify({
      id:root,driveId:providerDrive,mimeType:'application/vnd.google-apps.folder',
      trashed:false,capabilities:{canAddChildren}
    }),{status:providerStatus,headers:{'Content-Type':'application/json'}});
  };
  const tokenProvider=async()=>{
    if(failToken)throw Error('Never disclose refresh credentials');
    return {accessToken:'valid_TEST_access_token_of_sufficient_length',
      expiresInSeconds:3600};
  };
  const config={ledger,tokenProvider,actionId:action,destinationId:destination,
    organizationId:org,companyId:company,expectedEmail:account,
    expectedDriveId:drive,expectedRootId:root,internalDriveId:internal,
    testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',fetcher};
  return {calls,config};
}
test('service reads immutable org/company/root first; GET provider account/root; saves inactive receipt',async()=>{
  const r=rig();
  const result=await preflight(r.config);
  assert.deepEqual(result,{
    status:'CLIENT_DESTINATION_PREFLIGHT_RECORDED',
    destination_id:destination,company_id:company,
    provider_read_verified:true,preflight_recorded:true,
    verified:false,active:false,replayed:false
  });
  assert.deepEqual(r.calls.read,[destination]);
  assert.deepEqual(r.calls.write,[[action,candidate(),drive]]);
  assert.equal(r.calls.google.length,2);
});
test('same action replay never creates another destination or marks anything active',async()=>{
  const r=rig({receiptValue:{...receipt(),replayed:true}});
  assert.equal((await preflight(r.config)).replayed,true);
  assert.equal(r.calls.write.length,1);
});
test('missing TEST authority, IDs, actor/org scope or provider binding does not call Google or commit',async()=>{
  for(const changes of [
    {testEvidenceClass:'CUSTOMER'},
    {expectedRootId:internal},{expectedDriveId:root},
    {companyId:u(40)},{organizationId:u(41)},
    {expectedEmail:'different@example.org'},
    {actionId:'bad'}, {destinationId:'bad'}, {tokenProvider:null},
    {ledger:{}}
  ]){
    const r=rig();
    await assert.rejects(()=>preflight({...r.config,...changes}),
      e=>e?.code==='TEST_CLIENT_DESTINATION_PREFLIGHT_NOT_CONFIGURED'
        ||e?.code==='TEST_CLIENT_DESTINATION_SCOPE_MISMATCH');
    assert.equal(r.calls.google.length,0);
    assert.equal(r.calls.write.length,0);
  }
  for(const bad of [
    {...candidate(),provider:'OTHER'},
    {...candidate(),active:true},{...candidate(),verified:true},
    {...candidate(),company_id:u(39)},
    {...candidate(),organization_id:u(39)},
    {...candidate(),root_folder_id:'wrong_provider_root_123456'},
    {...candidate(),revision:'bad'},
    {...candidate(),provider_identity:'wrong@example.org'}
  ]){
    const r=rig({candidateValue:bad});
    await assert.rejects(()=>preflight(r.config),
      e=>e.code==='TEST_CLIENT_DESTINATION_SCOPE_MISMATCH');
    assert.equal(r.calls.google.length,0);
    assert.equal(r.calls.write.length,0);
  }
});
test('wrong Google identity, wrong Drive, or nonwritable root cannot record',async()=>{
  for(const options of [
    {providerEmail:'wrong@example.org'}, {providerDrive:'some_other_drive'},
    {canAddChildren:false}, {providerStatus:403}, {failToken:true}
  ]){
    const r=rig(options);
    await assert.rejects(()=>preflight(r.config));
    assert.equal(r.calls.write.length,0);
  }
});
test('a malformed service acknowledgement is not called active or successful',async()=>{
  for(const receiptValue of [
    {...receipt(),verified:true}, {...receipt(),active:true},
    {...receipt(),company_id:u(29)}, {...receipt(),preflight_recorded:false},
    {...receipt(),replayed:'yes'}
  ]){
    const r=rig({receiptValue});
    await assert.rejects(()=>preflight(r.config),
      e=>e.code==='TEST_CLIENT_DESTINATION_RECEIPT_UNVERIFIED');
    assert.equal(r.calls.write.length,1);
  }
});
test('service ledger uses only allowlisted authenticated RPC names and exact inputs',async()=>{
  const urls=[],jwt=['TEST_SERVICE_ONLY','HEADER','SIGNATURE'].join('.');
  const fetcher=async (req,opts)=>{
    urls.push({req,opts});
    assert.ok(req.startsWith(url+'/rest/v1/rpc/'));
    assert.equal(opts.method,'POST');
    assert.equal(opts.headers.Authorization,'Bearer '+jwt);
    if(req.endsWith('/service_read_client_destination_candidate'))
      return new Response(JSON.stringify(candidate()),{status:200});
    if(req.endsWith('/service_record_client_destination_preflight'))
      return new Response(JSON.stringify(receipt()),{status:200});
    throw Error('unexpected RPC');
  };
  const ledger=createServiceLedger({url,serviceRoleJwt:jwt,fetcher});
  assert.deepEqual(await ledger.readClientDestination(destination),candidate());
  assert.deepEqual(await ledger.recordClientDestinationPreflight(action,candidate(),drive),receipt());
  assert.equal(urls.length,2);
  assert.deepEqual(JSON.parse(urls[0].opts.body),{p_destination:destination});
  assert.deepEqual(JSON.parse(urls[1].opts.body),{
    p_action:action,p_destination:destination,p_expected_revision:revision,
    p_provider_identity:account,p_root:root,p_shared_drive:drive
  });
});
