import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLedger,selectHostedServiceCredential} from '../../supabase/functions/client-delivery/service-ledger.mjs';
import {DriveUncertain} from '../../supabase/functions/client-delivery/drive-client.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const token='legacyheader.legacypayload.legacysignature';
function mock(reply=()=>Response.json({claimed:false})){
 const calls=[];
 const ledger=createServiceLedger({url:'https://fwh-test.supabase.co',serviceRoleJwt:token,
  fetcher:async(url,options)=>{calls.push({url,options});return reply(new URL(url),options);}});
 return {ledger,calls};
}
test('hosted service-credential selection uses one privileged source and fails closed',()=>{
 const legacy='head.payload.sig';
 const secret='sb_secret_'+'q'.repeat(32);
 const choose=(modern)=>selectHostedServiceCredential({legacy,modern});
 assert.equal(choose(JSON.stringify({default:secret})),secret);
 assert.equal(choose(''),legacy);
 assert.equal(choose(undefined),legacy);
 for(const invalid of ['not JSON','{}','[]','null',
   JSON.stringify({default:'sb_publishable_'+'q'.repeat(32)}),
   JSON.stringify({default:'sb_secret_short'}),
   JSON.stringify({default:legacy}),
   JSON.stringify({other:secret})])assert.equal(choose(invalid),'');
});

test('only current legacy service JWT can access allowlisted private worker RPCs',async()=>{
 for(const [params,code] of [
  [{url:'http://fwh-test.supabase.co',serviceRoleJwt:token},'SERVICE_BACKEND_URL_INVALID'],
  [{url:'https://evil.invalid',serviceRoleJwt:token},'SERVICE_BACKEND_URL_INVALID'],
  [{url:'https://fwh-test.supabase.co',serviceRoleJwt:'sb_publishable_public'},'SERVICE_BACKEND_KEY_FORMAT_INVALID'],
  [{url:'https://fwh-test.supabase.co',serviceRoleJwt:token+'\n'},'SERVICE_BACKEND_KEY_FORMAT_INVALID']
 ]){
  assert.throws(()=>createServiceLedger(params),error=>
    error instanceof DriveUncertain&&error.code===code);
 }
 const {ledger,calls}=mock();
 assert.deepEqual(await ledger.claim(uuid(1)),{claimed:false});
 assert.equal(calls.length,1);
 assert.equal(new URL(calls[0].url).pathname,'/rest/v1/rpc/service_claim_delivery');
 assert.equal(calls[0].options.headers.apikey,token);
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
 assert.equal(calls[0].options.redirect,'error');
 assert.ok(!JSON.stringify(await ledger.claim(uuid(1))).includes(token));
});
test('supported server secret authenticates only as apikey, never bearer JWT',async()=>{
  const secret='sb_secret_'+ 'm'.repeat(32),calls=[];
  const ledger=createServiceLedger({url:'https://fwh-test.supabase.co',
    serviceRoleJwt:secret,fetcher:async(url,options)=>{
      calls.push({url,options});
      return Response.json({state:'NONE'});
    }});
  assert.deepEqual(await ledger.readActiveLease(),{state:'NONE'});
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0].url).pathname,
    '/rest/v1/rpc/service_read_active_delivery_lease');
  assert.equal(calls[0].options.headers.apikey,secret);
  assert.equal(Object.hasOwn(calls[0].options.headers,'Authorization'),false);
  for(const key of ['sb_publishable_'+'a'.repeat(32),
    'sb_secret_short','sb_secret_'+'a'.repeat(32)+'\n',
    'arbitrary-not-a-service-credential']){
    assert.throws(()=>createServiceLedger({url:'https://fwh-test.supabase.co',
      serviceRoleJwt:key}),e=>e instanceof DriveUncertain
        &&e.code==='SERVICE_BACKEND_KEY_FORMAT_INVALID');
  }
});

test('exact TEST claim uses only service RPC with pinned package, destination and root',async()=>{
 const worker=uuid(1),pkg=uuid(2),destination=uuid(3);
 const root='fwh_disposable_client_root_123456789';
 const {ledger,calls}=mock(()=>Response.json({claimed:false}));
 assert.deepEqual(await ledger.claimExactTest(worker,pkg,destination,root),{claimed:false});
 assert.equal(calls.length,1);
 assert.equal(new URL(calls[0].url).pathname,
   '/rest/v1/rpc/service_claim_exact_test_delivery');
 assert.deepEqual(JSON.parse(calls[0].options.body),{
   p_worker:worker,p_package:pkg,p_destination:destination,p_root:root
 });
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
 assert.equal(calls.some(x=>new URL(x.url).pathname.endsWith('/service_claim_delivery')),false);
 const missing=mock(()=>Response.json({code:'PGRST202',details:'PRIVATE_INFO'},{status:404}));
 await assert.rejects(()=>missing.ledger.claimExactTest(worker,pkg,destination,root),
   e=>e instanceof DriveUncertain&&e.code==='SERVICE_RPC_UNAVAILABLE'
   &&!e.message.includes('PRIVATE_INFO'));
 assert.equal(missing.calls.length,1,'no broad claim retry after missing exact RPC');
});
test('recovery reads only original durable active-lease RPC using service JWT',async()=>{
 const {ledger,calls}=mock(()=>Response.json({state:'NONE'}));
 assert.deepEqual(await ledger.readActiveLease(),{state:'NONE'});
 assert.equal(calls.length,1);
 assert.equal(new URL(calls[0].url).pathname,
  '/rest/v1/rpc/service_read_active_delivery_lease');
 assert.deepEqual(JSON.parse(calls[0].options.body),{});
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
 assert.equal(calls[0].options.redirect,'error');
 assert.equal(calls.some(x=>/service_claim|service_heartbeat|quarantine/.test(x.url)),false);
});
test('correct fenced lease identity is supplied for all upload session and delivery RPCs',async()=>{
 const pkg=uuid(1),worker=uuid(2),file=uuid(3),g=7;
 const {ledger,calls}=mock(url=>Response.json(
   url.pathname.endsWith('/service_begin_upload_session')
     ? {plan_id:file,start_recorded:true} : {exists:false}));
 const inner=ledger.forLease(pkg,worker,g);
 assert.equal(await inner.getSession(file),null);
 await inner.getFilePlan(file);
 assert.deepEqual(await inner.beginSession(file),{plan_id:file,start_recorded:true});
 await inner.storeSession(pkg,worker,g,file,{version:1,nonce:'none',payload:'encrypted'});
 await inner.recordOffset(pkg,worker,g,file,131072,false);
 await inner.confirmFile({package_id:pkg,kind:'PHOTO',photo_id:uuid(4),mime:'image/jpeg'},
  worker,g,{id:'drive-file-123456',parent:'folder-123456',sha256:'a'.repeat(64),size:100});
 assert.deepEqual(calls.map(c=>new URL(c.url).pathname.split('/').pop()),
  ['service_read_upload_session','service_get_delivery_file_plan','service_begin_upload_session',
   'service_store_upload_session','service_record_upload_offset','service_confirm_delivery_file']);
 for(const c of calls){
   assert.equal(JSON.parse(c.options.body).p_package,pkg);
   assert.equal(JSON.parse(c.options.body).p_worker,worker);
   assert.equal(JSON.parse(c.options.body).p_generation,g);
 }
});
test('scoped address and WO folder lookups retain server-only current-lease arguments',async()=>{
 const pkg=uuid(1),worker=uuid(2),g=7;
 const {ledger,calls}=mock(()=>Response.json({exists:false}));
 await ledger.readParent(pkg,worker,g,'ADDRESS');
 await ledger.reserveParent(pkg,worker,g,'ADDRESS','generated-folder-0001','root-folder-0001');
 await ledger.readParent(pkg,worker,g,'WORK_ORDER');
 await ledger.reserveParent(pkg,worker,g,'WORK_ORDER','generated-folder-0002','generated-folder-0001');
 assert.deepEqual(calls.map(c=>new URL(c.url).pathname.split('/').pop()),[
  'service_read_delivery_parent','service_reserve_delivery_parent',
  'service_read_delivery_parent','service_reserve_delivery_parent']);
 for(const call of calls){
   const arg=JSON.parse(call.options.body);
   assert.equal(arg.p_package,pkg);
   assert.equal(arg.p_worker,worker);
   assert.equal(arg.p_generation,g);
   assert.ok(['ADDRESS','WORK_ORDER'].includes(arg.p_kind));
   assert.equal(call.options.headers.Authorization,'Bearer '+token);
   assert.equal(call.options.redirect,'error');
 }
 const mapId=uuid(9),proof={id:'generated-folder-0001',parent:'root-folder-0001',name:'address-123'};
 await ledger.beginParentCreate(pkg,worker,g,mapId);
 await ledger.confirmParent(pkg,worker,g,mapId,proof);
 assert.deepEqual(calls.slice(-2).map(call=>new URL(call.url).pathname.split('/').pop()),[
   'service_begin_delivery_parent_create','service_confirm_delivery_parent']);
 const begin=JSON.parse(calls.at(-2).options.body);
 const confirm=JSON.parse(calls.at(-1).options.body);
 for(const a of [begin,confirm]){
   assert.equal(a.p_package,pkg);assert.equal(a.p_worker,worker);
   assert.equal(a.p_generation,g);assert.equal(a.p_map,mapId);
 }
 assert.deepEqual(confirm.p_proof,proof);
 const missing=JSON.parse(calls[0].options.body);
 assert.equal('p_remote_id' in missing,false);
 const present=JSON.parse(calls[1].options.body);
 assert.equal(present.p_remote_id,'generated-folder-0001');
 assert.equal(present.p_parent_id,'root-folder-0001');
});
test('package folder uses current fenced lease for one-shot get/begin/confirm',async()=>{
 const pkg=uuid(1),worker=uuid(2),plan=uuid(3),generation=7;
 const {ledger,calls}=mock(()=>Response.json({state:'PREALLOCATED'}));
 const scoped=ledger.forLease(pkg,worker,generation);
 await scoped.getFolderPlan(plan);
 await scoped.beginFolderCreate(plan);
 await scoped.confirmFolder({package_id:pkg,plan_id:plan},worker,generation,{
   id:'folder_immutable_12345',parent:'wo_immutable_123456',
   name:'package-'+pkg,mime:'application/vnd.google-apps.folder',
   drive_id:'client_drive_001',trashed:false,
   appProperties:{fwh_package:pkg,fwh_manifest:'a'.repeat(64)},
   sha256:null,size:null
 });
 assert.deepEqual(calls.map(x=>new URL(x.url).pathname.split('/').pop()),[
   'service_get_delivery_folder_plan','service_begin_delivery_folder_create',
   'service_confirm_delivery_folder']);
 for(const call of calls){
   const body=JSON.parse(call.options.body);
   assert.equal(body.p_package,pkg);
   assert.equal(body.p_worker,worker);
   assert.equal(body.p_generation,generation);
   assert.equal(body.p_plan,plan);
   assert.equal(call.options.headers.Authorization,'Bearer '+token);
 }
 assert.equal(JSON.parse(calls[2].options.body).p_proof.drive_id,'client_drive_001');
});
test('unauthorized and ambiguous backend failures never reveal service secrets or claim delivery',async()=>{
 for(const status of [401,403,503]){
  const {ledger}=mock(()=>Response.json({secret:'not to show'}, {status}));
  await assert.rejects(()=>ledger.claim(uuid(1)),e=>
   e instanceof DriveUncertain&&e.code===(status===503?'SERVICE_RPC_UNAVAILABLE':'SERVICE_RPC_AUTH_DENIED')
    &&!e.message.includes('not to show'));
 }
 const {ledger}=mock(()=>{throw Error('private backend failed');});
 await assert.rejects(()=>ledger.claim(uuid(1)),e=>
  e instanceof DriveUncertain&&e.code==='SERVICE_RPC_OUTCOME_UNCERTAIN');
});

test('next reserved item lookup is service-only and bound to original lease IDs',async()=>{
 const pkg=uuid(1),worker=uuid(2),generation=3,plan=uuid(4);
 const {ledger,calls}=mock(()=>Response.json({state:'FOLDER',plan_id:plan}));
 const result=await ledger.nextReservedItem(pkg,worker,generation);
 assert.deepEqual(result,{state:'FOLDER',plan_id:plan});
 assert.equal(new URL(calls[0].url).pathname,
  '/rest/v1/rpc/service_next_delivery_item');
 assert.deepEqual(JSON.parse(calls[0].options.body),{
  p_package:pkg,p_worker:worker,p_generation:generation});
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
 assert.equal(calls[0].options.redirect,'error');
});

test('atomic file set RPC preserves ordered immutable IDs under original lease',async()=>{
 const pkg=uuid(1),worker=uuid(2),g=3;
 const photos=[{photo_id:uuid(4),file_id:'google_0123456789012345'}];
 const {ledger,calls}=mock(()=>Response.json({reserved:true,package_id:pkg,
  folder_id:'folder_012345678901234',manifest_id:'manifest_012345678901',reserved_count:3}));
 const ack=await ledger.reserveBatch(pkg,worker,g,'folder_012345678901234',
  'wo_012345678901234567',photos,'manifest_012345678901');
 assert.equal(ack.reserved,true);
 assert.equal(new URL(calls[0].url).pathname,
  '/rest/v1/rpc/service_reserve_delivery_file_set');
 assert.deepEqual(JSON.parse(calls[0].options.body),{
  p_package:pkg,p_worker:worker,p_generation:g,
  p_folder_id:'folder_012345678901234',p_parent_id:'wo_012345678901234567',
  p_photos:photos,p_manifest_id:'manifest_012345678901'});
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
});

test('final provider verification snapshot is service-only and lease-fenced',async()=>{
 const pkg=uuid(1),worker=uuid(2),generation=3;
 const {ledger,calls}=mock(()=>Response.json({package_id:pkg,ancestors:[],files:[]}));
 await ledger.finalProviderSnapshot(pkg,worker,generation);
 assert.equal(new URL(calls[0].url).pathname,
  '/rest/v1/rpc/service_delivery_final_provider_snapshot');
 assert.deepEqual(JSON.parse(calls[0].options.body),{
  p_package:pkg,p_worker:worker,p_generation:generation});
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
});

test('single-flight permit RPCs carry a server-generated request only, no package or remote ID',async()=>{
 const dispatch=uuid(23);
 const {ledger,calls}=mock(url=>Response.json(
  url.pathname.endsWith('/service_acquire_delivery_dispatch')
    ? {acquired:true} : {released:true}));
 assert.deepEqual(await ledger.acquireDispatch(dispatch),{acquired:true});
 assert.deepEqual(await ledger.releaseDispatch(dispatch),{released:true});
 assert.deepEqual(calls.map(x=>new URL(x.url).pathname),[
  '/rest/v1/rpc/service_acquire_delivery_dispatch',
  '/rest/v1/rpc/service_release_delivery_dispatch'
 ]);
 for(const c of calls){
  assert.deepEqual(JSON.parse(c.options.body),{p_request:dispatch});
  assert.equal(c.options.headers.Authorization,'Bearer '+token);
  assert.equal(c.options.redirect,'error');
 }
});
