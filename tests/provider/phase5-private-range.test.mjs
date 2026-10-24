import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyExistingDisposablePrivatePhoto as verify}
  from './phase5-private-range.mjs';

const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=u(1),owner=u(2),photo=u(3),admin=u(4),other=u(7),version=u(9);
const path=[org,u(5),u(6),photo+'.jpg'].join('/');
const HOST='https://vyocaujuwrivoqynvitm.supabase.co';
const signedUrl=HOST+'/storage/v1/object/sign/fwh-review-private/'+path+'?token=ephemeral-test-only';
const data=Uint8Array.from({length:300003},(_,i)=>i%251);
const jwt=(sub,metadataOrg=org)=>['eyJhbGciOiJub25lIn0',Buffer.from(JSON.stringify({
  sub,role:'authenticated',session_id:u(8),app_metadata:{organization_id:metadataOrg}
})).toString('base64url'),'fictional-signature'].join('.');
const adminJwt=jwt(admin),ownerJwt=jwt(owner),otherUserJwt=jwt(other);
const fixture=()=>({
  fixtureType:'DISPOSABLE_FWH_TEST_ONLY',projectUrl:HOST,
  bucket:'fwh-review-private',ownerId:owner,photoId:photo,
  transferVersion:version,objectKey:path,
  sha256:createHash('sha256').update(data).digest('hex'),size:data.length,
  publishableKey:'test-publishable-key-not-a-real-credential',
  adminJwt,ownerJwt,otherUserJwt
});
const json=(content,status=200)=>new Response(JSON.stringify(content),{
  status,headers:{'Content-Type':'application/json'}});
function rig({anonDirect=401,ownerDirect=403,anonEdge=401,otherEdge=403,
  signedStatus=200,signedBody={},rangeStatus=206,wrongRange=false,
  truncated=false,corrupt=false}={}){
  const requests=[];
  const fetcher=async (url,opts)=>{
    requests.push({url,opts});
    assert.ok(url.startsWith(HOST+'/'));
    assert.equal(opts.redirect,'error');
    if(url.includes('/object/authenticated/')){
      assert.equal(opts.method,'GET');
      return json({error:'no direct received-photo read'},
        opts.headers.Authorization?ownerDirect:anonDirect);
    }
    if(url.endsWith('/functions/v1/admin-private-photo')){
      assert.equal(opts.method,'POST');
      assert.deepEqual(JSON.parse(opts.body),
        {photo_id:photo,transfer_version:version});
      const who=opts.headers.Authorization;
      if(!who)return json({error:'missing auth'},anonEdge);
      if(who==='Bearer '+otherUserJwt)return json({error:'wrong scope'},otherEdge);
      assert.equal(who,'Bearer '+adminJwt);
      if(signedStatus!==200)return json({error:'denied'},signedStatus);
      return json({photo_id:photo,transfer_version:version,url:signedUrl,
        expires_in:120,...signedBody});
    }
    assert.equal(url,signedUrl);
    assert.equal(opts.method,'GET');
    assert.equal(opts.headers.Authorization,undefined);
    assert.equal(opts.headers.apikey,undefined);
    const range=/^bytes=(\d+)-(\d+)$/.exec(opts.headers.Range);
    assert.ok(range);
    const start=Number(range[1]),end=Number(range[2]);
    const chunk=data.slice(start,end+1-(truncated?1:0));
    if(corrupt&&start===0)chunk[0]^=1;
    return new Response(chunk,{status:rangeStatus,headers:{
      'Content-Type':'image/jpeg',
      'Content-Range':'bytes '+start+'-'+(wrongRange?end+1:end)+'/'+data.length,
      'Content-Length':String(chunk.length)}});
  };
  return {fetcher,requests};
}
test('RECEIVED photo: no direct access, authorized signer and exact signed 206 SHA-256',async()=>{
  const r=rig(),result=await verify(fixture(),r);
  assert.deepEqual(result,{gate:'REAL_RECEIVED_TEST_PHOTO_SIGNED_RANGE',
    verified:true,anonymous:'DENIED',owner_direct:'DENIED',other_office:'DENIED',
    bytes:data.length,chunks:2,remote_hash_verified:true});
  assert.equal(r.requests.length,7);
  assert.ok(r.requests[5].url.includes('?token='));
  assert.equal(r.requests[5].opts.headers.Range,'bytes=0-262143');
  assert.equal(r.requests[6].opts.headers.Range,'bytes=262144-300002');
  for(const secret of [adminJwt,ownerJwt,otherUserJwt,'ephemeral-test-only']){
    assert.equal(JSON.stringify(result).includes(secret),false);
  }
});
test('missing optional JWTs are explicit unverified boundaries, not false PASS',async()=>{
  const f=fixture();delete f.ownerJwt;delete f.otherUserJwt;
  const r=rig(),result=await verify(f,r);
  assert.equal(result.owner_direct,'NOT_SUPPLIED');
  assert.equal(result.other_office,'NOT_SUPPLIED');
  assert.equal(r.requests.length,5);
});
test('bad identity, project, customer evidence and credentials make zero requests',async()=>{
  const f=fixture();
  const variants=[
    {...f,projectUrl:'https://other.supabase.co'}, {...f,bucket:'public'},
    {...f,fixtureType:'CUSTOMER'}, {...f,photoId:u(11)},
    {...f,objectKey:path+'/nested'}, {...f,transferVersion:'bad'},
    {...f,size:0}, {...f,sha256:'bad'},
    {...f,adminJwt:jwt(admin,u(21))},
    {...f,ownerJwt:jwt(other)},
    {...f,otherUserJwt:f.adminJwt},
    {...f,adminJwt:'service-role-not-a-user'},
  ];
  for(const input of variants){
    const r=rig();
    await assert.rejects(()=>verify(input,r),e=>e.code==='INVALID_TEST_CONFIGURATION');
    assert.equal(r.requests.length,0);
  }
});
test('anonymous or direct received owner exposure fails before signing',async()=>{
  for(const options of [{anonDirect:206},{ownerDirect:206},{anonEdge:200}]){
    const r=rig(options);
    await assert.rejects(()=>verify(fixture(),r),e=>
      ['ANONYMOUS_ACCESS_EXPOSED','RECEIVED_OWNER_DIRECT_ACCESS_EXPOSED'].includes(e.code));
    assert.ok(r.requests.length<=3);
  }
});
test('foreign user must fail authorization before signed URL minting',async()=>{
  const r=rig({otherEdge:200});
  await assert.rejects(()=>verify(fixture(),r),e=>e.code==='FOREIGN_OFFICE_ACCESS_EXPOSED');
  assert.equal(r.requests.length,4);
});
test('signer must return exact short-lived fixed-origin photo link',async()=>{
  const bad=[
    {url:'https://evil.invalid/object/sign?token=bad'},
    {url:signedUrl.replace(photo+'.jpg','wrong.jpg')},
    {url:signedUrl+'&download=1'},
    {url:signedUrl.replace('token=','key=')},
    {url:signedUrl+'#fragment'},
    {url:signedUrl.replace('?token=','?x=')},
    {expires_in:3600},
    {photo_id:u(15)},
    {transfer_version:u(17)},
  ];
  for(const signedBody of bad){
    const r=rig({signedBody});
    await assert.rejects(()=>verify(fixture(),r),e=>e.code==='PRIVATE_SIGNED_URL_INVALID');
    assert.equal(r.requests.length,5);
  }
  const r=rig({signedStatus:403});
  await assert.rejects(()=>verify(fixture(),r),e=>e.code==='PRIVATE_READ_UNAUTHORIZED');
});
test('signed bytes need 206, exact range, byte count and whole SHA-256',async()=>{
  for(const options of [{rangeStatus:200},{wrongRange:true},{truncated:true},{corrupt:true}]){
    const r=rig(options);
    await assert.rejects(()=>verify(fixture(),r),e=>[
      'REMOTE_PARTIAL_RANGE_REQUIRED','REMOTE_RANGE_IDENTITY_MISMATCH',
      'REMOTE_BYTE_LENGTH_MISMATCH','REMOTE_CONTENT_CHANGED'].includes(e.code));
    assert.ok(r.requests.length>=6);
  }
});
test('network errors do not disclose private access tokens or signed links',async()=>{
  const secret='DO_NOT_LEAK_PRIVATE_AUTH_OR_URL';
  const r=rig();
  await assert.rejects(()=>verify(fixture(),{fetcher:async()=>{throw Error(secret);}}),e=>{
    assert.equal(e.code,'REMOTE_READ_FAILED');
    assert.equal(e.message.includes(secret),false);
    return true;
  });
  assert.equal(r.requests.length,0);
});
