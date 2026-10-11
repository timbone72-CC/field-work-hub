import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyExistingDisposablePrivatePhoto as verify}
  from './phase5-private-range.mjs';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const u=(n)=>uuid(n),org=u(1),owner=u(2),photo=u(3),wrong=u(4);
const payload=(sub,role='authenticated')=>({
 sub,role,session_id:u(8),app_metadata:{organization_id:org}});
const jwt=claims=>['eyJhbGciOiJub25lIn0',
  Buffer.from(JSON.stringify(claims)).toString('base64url'),'fictional-signature'].join('.');
const data=Uint8Array.from({length:300003},(_,i)=>i%251);
const key=[org,u(5),u(6),photo+'.jpg'].join('/');
const fixture=()=>({
 fixtureType:'DISPOSABLE_FWH_TEST_ONLY',
 projectUrl:'https://vyocaujuwrivoqynvitm.supabase.co',
 bucket:'fwh-review-private',ownerId:owner,photoId:photo,objectKey:key,
 sha256:createHash('sha256').update(data).digest('hex'),size:data.length,
 publishableKey:'test-publishable-key-not-a-real-credential',
 ownerJwt:jwt(payload(owner)),otherOwnerJwt:jwt(payload(wrong))
});
function rig({anonStatus=401,wrongStatus=403,ownerStatus=206,
  wrongRange=false,truncated=false,corrupt=false}={}){
 const requests=[];
 const fetcher=async (url,opts)=>{
  requests.push({url,opts});
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.apikey,fixture().publishableKey);
  const authenticated=opts.headers.Authorization;
  if(!authenticated)return Response.json({status:'denied'},{status:anonStatus});
  if(authenticated==='Bearer '+fixture().otherOwnerJwt)
    return Response.json({status:'denied'},{status:wrongStatus});
  assert.equal(authenticated,'Bearer '+fixture().ownerJwt);
  const range=/^bytes=(\d+)-(\d+)$/.exec(opts.headers.Range);
  assert.ok(range,'one bounded range is mandatory');
  const start=Number(range[1]),end=Number(range[2]);
  const part=data.slice(start,end+1-(truncated?1:0));
  if(corrupt&&start===0)part[0]^=1;
  const headers={'Content-Type':'image/jpeg',
    'Content-Range':`bytes ${start}-${wrongRange?end+1:end}/${data.length}`,
    'Content-Length':String(part.length)};
  return new Response(part,{status:ownerStatus,headers});
 };
 return {fetcher,requests};
}
test('real-provider gate reads exact private byte ranges and validates complete SHA-256',async()=>{
 const r=rig();
 const result=await verify(fixture(),r);
 assert.deepEqual(result,{gate:'REAL_EXISTING_DISPOSABLE_PHOTO_RANGE',verified:true,
  anonymous:'DENIED',other_owner:'DENIED',bytes:data.length,chunks:2,
  remote_hash_verified:true});
 assert.equal(r.requests.length,4);
 assert.equal(r.requests[0].opts.headers.Authorization,undefined);
 assert.equal(r.requests[1].opts.headers.Authorization,'Bearer '+fixture().otherOwnerJwt);
 assert.equal(r.requests[2].opts.headers.Range,'bytes=0-262143');
 assert.equal(r.requests[3].opts.headers.Range,'bytes=262144-300002');
 assert.equal(JSON.stringify(result).includes(fixture().ownerJwt),false);
});
test('rejects wrong project, wrong bucket, non-test evidence, forged/mismatched owner',async()=>{
 const f=fixture();
 const variants=[
  {...f,projectUrl:'https://fpp.supabase.co'},
  {...f,bucket:'a-public-bucket'},
  {...f,fixtureType:'CUSTOMER'},
  {...f,photoId:u(7)},
  {...f,objectKey:key+'/nested'},
  {...f,ownerId:wrong},
  {...f,ownerJwt:jwt(payload(owner,'service_role'))},
  {...f,ownerJwt:jwt({...payload(owner),session_id:'not-a-uuid'})},
  {...f,ownerJwt:jwt({...payload(owner),app_metadata:{organization_id:u(9)}})},
  {...f,size:0},
  {...f,sha256:'bad'},
  {...f,otherOwnerJwt:f.ownerJwt}
 ];
 for(const variant of variants){
  const r=rig();
  await assert.rejects(()=>verify(variant,r),e=>e.code==='INVALID_TEST_CONFIGURATION');
  assert.equal(r.requests.length,0,'configuration failures must never make a network request');
 }
});
test('without second account, disclose NOT_SUPPLIED rather than invent wrong-owner PASS',async()=>{
 const f=fixture();delete f.otherOwnerJwt;
 const r=rig(),result=await verify(f,r);
 assert.equal(result.other_owner,'NOT_SUPPLIED');
 assert.equal(r.requests.length,3);
});
test('anonymous or wrong-owner exposure aborts before receiving test evidence',async()=>{
 for(const options of [{anonStatus:206},{wrongStatus:200}]){
  const r=rig(options);
  await assert.rejects(()=>verify(fixture(),r),e=>
    e.code===(options.anonStatus?'ANONYMOUS_ACCESS_EXPOSED':'FOREIGN_OWNER_ACCESS_EXPOSED'));
  assert.ok(r.requests.length<=2);
 }
});
test('remote provider must send 206, exact Content-Range and full unaltered bytes',async()=>{
 for(const options of [{ownerStatus:200},{wrongRange:true},
   {truncated:true},{corrupt:true}]){
  const r=rig(options);
  await assert.rejects(()=>verify(fixture(),r),e=>[
    'REMOTE_PARTIAL_RANGE_REQUIRED','REMOTE_RANGE_IDENTITY_MISMATCH',
    'REMOTE_BYTE_LENGTH_MISMATCH','REMOTE_CONTENT_CHANGED'].includes(e.code));
  assert.ok(r.requests.length>=3);
 }
});
test('provider network failure is reported without propagating arbitrary secret-bearing error',async()=>{
 const r=rig();
 const secret='DONOTLEAK_PRIVATE_IDENTITY_OR_TOKEN';
 const fetcher=async (...args)=>{
  if(r.requests.length===0)throw Error(secret);
  return r.fetcher(...args);
 };
 await assert.rejects(()=>verify(fixture(),{fetcher}),e=>{
  assert.equal(e.code,'REMOTE_READ_FAILED');
  assert.equal(e.message.includes(secret),false);
  return true;
 });
});
