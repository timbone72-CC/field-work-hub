import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceLedger} from '../../supabase/functions/client-delivery/service-ledger.mjs';
import {DriveUncertain} from '../../supabase/functions/client-delivery/drive-client.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const token='legacyheader.legacypayload.legacysignature';
function mock(reply=()=>Response.json({claimed:false})){
 const calls=[];
 const ledger=createServiceLedger({url:'https://fwh-test.supabase.co',serviceRoleJwt:token,
  fetcher:async(url,options)=>{calls.push({url,options});return reply(new URL(url),options);}});
 return {ledger,calls};
}
test('only current legacy service JWT can access allowlisted private worker RPCs',async()=>{
 for(const params of [{url:'http://fwh-test.supabase.co',serviceRoleJwt:token},
  {url:'https://evil.invalid',serviceRoleJwt:token},
  {url:'https://fwh-test.supabase.co',serviceRoleJwt:'sb_publishable_public'},
  {url:'https://fwh-test.supabase.co',serviceRoleJwt:token+'\n'}]){
  assert.throws(()=>createServiceLedger(params),DriveUncertain);
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
test('correct fenced lease identity is supplied for all upload session and delivery RPCs',async()=>{
 const pkg=uuid(1),worker=uuid(2),file=uuid(3),g=7;
 const {ledger,calls}=mock(()=>Response.json({exists:false}));
 const inner=ledger.forLease(pkg,worker,g);
 assert.equal(await inner.getSession(file),null);
 await inner.storeSession(pkg,worker,g,file,{version:1,nonce:'none',payload:'encrypted'});
 await inner.recordOffset(pkg,worker,g,file,131072,false);
 await inner.confirmFile({package_id:pkg,kind:'PHOTO',photo_id:uuid(4),mime:'image/jpeg'},
  worker,g,{id:'drive-file-123456',parent:'folder-123456',sha256:'a'.repeat(64),size:100});
 assert.deepEqual(calls.map(c=>new URL(c.url).pathname.split('/').pop()),
  ['service_read_upload_session','service_store_upload_session',
   'service_record_upload_offset','service_confirm_delivery_file']);
 for(const c of calls){
   assert.equal(JSON.parse(c.options.body).p_package,pkg);
   assert.equal(JSON.parse(c.options.body).p_worker,worker);
   assert.equal(JSON.parse(c.options.body).p_generation,g);
 }
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
