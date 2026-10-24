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


import {proveInactiveClientDestinationFolder as prove}
 from '../../supabase/functions/client-delivery/worker-runtime.mjs';
const proofId='fwh_disposable_client_proof_123456789';
const proofAction=u(6),preflightAction=action;
const proofName='FWH DISPOSABLE CLIENT PROOF '+proofAction.replaceAll('-','').slice(0,12);
const proofProps={fwh_org:org,fwh_company:company,fwh_destination:destination,
 fwh_kind:'ADDRESS',fwh_key:proofAction};
const receiptProof=()=>({destination_id:destination,verified:true,active:false,replayed:false});
function proofRig({saved=false,completed=false,postError=false,wrongGet=false,
 wrongList=false,noPreflight=false,reserveError=false,attestError=false,
 wrongRoot=false}={}){
 const events=[],logs=[],plans=[];
 const savedPlan={
  exists:true,completed,action_id:proofAction,preflight_action_id:preflightAction,
  destination_id:destination,organization_id:org,company_id:company,
  root_folder_id:root,drive_id:drive,folder_id:proofId,folder_name:proofName,
  revision,provider_identity:account
 };
 const ledger={
  readClientDestinationProviderProof:async id=>{events.push('READ_PLAN');assert.equal(id,destination);
    return saved?savedPlan:{exists:false};},
  readClientDestination:async id=>{events.push('READ_CANDIDATE');assert.equal(id,destination);
    return wrongRoot?{...candidate(),root_folder_id:'different_client_root'}:candidate();},
  recordClientDestinationPreflight:async (...args)=>{events.push('RECORD_PREFLIGHT');
    if(noPreflight)throw Error('preflight unavailable');
    assert.equal(args[0],preflightAction);return receipt();},
  reserveClientDestinationProviderProof:async (...args)=>{
    events.push('RESERVE');
    if(reserveError)throw Error('database reserve outcome uncertain');
    plans.push(args);
    return {reserved:true,replayed:false,folder_id:proofId,folder_name:proofName,
      destination_id:destination,organization_id:org,company_id:company,
      root_folder_id:root,drive_id:drive};
  },
  confirmClientDestinationProviderProof:async (...args)=>{
   events.push('CONFIRM');
   if(attestError)throw Error('database confirmation uncertain');
   assert.deepEqual(args.map((x,i)=>i===2?'CANDIDATE':x),
     [proofAction,preflightAction,'CANDIDATE',proofId,drive]);
   return receiptProof();
  }
 };
 const fetcher=async(url,opts)=>{
  const target=new URL(url),method=opts?.method??'GET';
  logs.push({path:target.pathname,method,query:target.searchParams.toString()});
  if(target.pathname==='/drive/v3/about')
   return new Response(JSON.stringify({user:{emailAddress:account,me:true,
     permissionId:'same-trusted-provider'}}),{status:200,headers:{'Content-Type':'application/json'}});
  if(target.pathname==='/drive/v3/files/generateIds')
   return new Response(JSON.stringify({ids:[proofId]}),{status:200,headers:{'Content-Type':'application/json'}});
  if(target.pathname==='/drive/v3/files/'+root)
   return new Response(JSON.stringify({id:root,trashed:false,
      mimeType:'application/vnd.google-apps.folder',driveId:drive,
      capabilities:{canAddChildren:true}}),{status:200,headers:{'Content-Type':'application/json'}});
  if(target.pathname==='/drive/v3/files'&&method==='POST'){
   assert.equal(events.at(-1),'RESERVE','no POST until durable reservation');
   const body=JSON.parse(opts.body);
   assert.equal(body.id,proofId);assert.equal(body.parents[0],root);
   assert.deepEqual(body.appProperties,proofProps);
   if(postError)throw Error('remote POST outcome uncertain');
   return new Response(JSON.stringify({id:proofId}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if(target.pathname==='/drive/v3/files/'+proofId){
   return new Response(JSON.stringify({
     id:proofId,trashed:false,driveId:drive,mimeType:'application/vnd.google-apps.folder',
     name:proofName,parents:[wrongGet?'wrongParent':root],appProperties:proofProps
   }),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if(target.pathname==='/drive/v3/files'&&method==='GET'){
   assert.equal(target.searchParams.get('driveId'),drive);
   assert.match(target.searchParams.get('q'),/ in parents and name = /);
   return new Response(JSON.stringify({files:[{
     id:proofId,trashed:false,driveId:drive,
     mimeType:'application/vnd.google-apps.folder',
     name:proofName,parents:[root],appProperties:wrongList?
       {...proofProps,fwh_company:u(77)}:proofProps
   }]}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  throw Error('Unexpected provider request '+method+' '+target.pathname);
 };
 const tokenProvider=async()=>({accessToken:'mocked-private-test-workspace-access-token',
   expiresInSeconds:3600});
 const config={ledger,tokenProvider,actionId:proofAction,
  preflightActionId:preflightAction,destinationId:destination,
  organizationId:org,companyId:company,expectedEmail:account,
  expectedDriveId:drive,expectedRootId:root,internalDriveId:internal,
  testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',allowProviderCreate:true,fetcher};
 return {config,logs,events,plans};
}
test('new TEST proof reserves exact file ID before ONE folder POST then GET, list and receipt',async()=>{
 const r=proofRig();
 const result=await prove(r.config);
 assert.deepEqual(result,{status:'CLIENT_DESTINATION_VERIFIED_INACTIVE',
  destination_id:destination,company_id:company,verified:true,active:false,
  replayed:false,provider_writes_performed:true});
 const methods=r.logs.filter(x=>x.method==='POST');
 assert.equal(methods.length,1);
 assert.ok(r.events.indexOf('RESERVE')>=0);
 assert.equal(r.events.at(-1),'CONFIRM');
 assert.equal(r.plans.length,1);
});
test('saved reservation resumes GET/LIST, never POST or new Drive ID even when allowCreate=true',async()=>{
 const r=proofRig({saved:true});
 const result=await prove(r.config);
 assert.equal(result.active,false);
 assert.equal(result.provider_writes_performed,false);
 assert.equal(r.logs.filter(x=>x.method==='POST').length,0);
 assert.equal(r.logs.filter(x=>x.path.endsWith('/generateIds')).length,0);
 assert.equal(r.events.includes('RESERVE'),false);
 assert.equal(r.events.at(-1),'CONFIRM');
});
test('confirmed receipt replay cannot reopen Google create or mark destination active',async()=>{
 const r=proofRig({saved:true,completed:true});
 const result=await prove(r.config);
 assert.equal(result.replayed,true);
 assert.equal(result.verified,true);
 assert.equal(result.active,false);
 assert.equal(r.logs.length,0);
 assert.deepEqual(r.events,['READ_PLAN']);
});
test('remote lost POST reply reconciles only same-ID GET/LIST, no blind retry',async()=>{
 const r=proofRig({postError:true});
 const result=await prove(r.config);
 assert.equal(result.verified,true);
 assert.equal(r.logs.filter(x=>x.method==='POST').length,1);
 assert.equal(r.events.at(-1),'CONFIRM');
});
test('absent explicit create approval makes zero Google calls and zero reservation',async()=>{
 const r=proofRig();
 await assert.rejects(()=>prove({...r.config,allowProviderCreate:false}),
  e=>e.code==='CLIENT_PROOF_CREATION_NOT_AUTHORIZED');
 assert.deepEqual(r.events,['READ_PLAN']);assert.equal(r.logs.length,0);
});
test('server reservation uncertainty stops before provider POST; no alternate file ID created',async()=>{
 const r=proofRig({reserveError:true});
 await assert.rejects(()=>prove(r.config));
 assert.equal(r.logs.filter(x=>x.method==='POST').length,0);
 assert.equal(r.events.includes('CONFIRM'),false);
});
test('wrong remote GET or independent list cannot mark a client destination verified',async()=>{
 for(const options of [{wrongGet:true},{wrongList:true}]){
  const r=proofRig(options);
  await assert.rejects(()=>prove(r.config));
  assert.equal(r.events.includes('CONFIRM'),false);
  assert.equal(r.logs.filter(x=>x.method==='POST').length,1);
 }
});
test('wrong client/root, absent preflight or invalid TEST scope cannot begin provider creation',async()=>{
 for(const options of [{wrongRoot:true},{noPreflight:true}]){
  const r=proofRig(options);
  await assert.rejects(()=>prove(r.config));
  assert.equal(r.events.includes('RESERVE'),false);
  assert.equal(r.logs.filter(x=>x.method==='POST').length,0);
 }
 for(const changes of [
  {testEvidenceClass:'CUSTOMER'},{companyId:u(80)},{organizationId:u(81)},
  {expectedRootId:internal},{expectedDriveId:root},{actionId:'bad'},
  {preflightActionId:'bad'}, {expectedEmail:'wrong@example.org'}
 ]){
  const r=proofRig();
  await assert.rejects(()=>prove({...r.config,...changes}));
  assert.equal(r.events.includes('RESERVE'),false);
  assert.equal(r.logs.filter(x=>x.method==='POST').length,0);
 }
});
test('unconfirmed service receipt never implies remote delivery or activation',async()=>{
 const r=proofRig({attestError:true});
 await assert.rejects(()=>prove(r.config));
 assert.equal(r.events.at(-1),'CONFIRM');
});
