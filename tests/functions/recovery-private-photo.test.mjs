import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivatePhotoViewer } from '../../supabase/functions/admin-private-photo/handler.mjs';

const [photo, version, user, session, object, org, wo, run] =
  Array.from({ length: 8 }, () => crypto.randomUUID());
const path = `${org}/${wo}/${run}/${photo}.jpg`;
const jwt = 'header.' + Buffer.from(JSON.stringify({ sub: user,
  session_id: session })).toString('base64url') + '.signature';
const target = { photo_id: photo, transfer_version: version, bucket: 'fwh-review-private',
  object_key: path, object_id: object, object_version: 'V1' };
const json = (v,status=200) => new Response(JSON.stringify(v),{status});
const request = (data={photo_id:photo,transfer_version:version},auth='Bearer '+jwt) =>
  new Request('https://example.invalid',{method:'POST',headers:{
    Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(data)});
function fixture(overrides={}){
  const calls=[];
  const handle=createPrivatePhotoViewer({url:'https://fwh-disposable.supabase.co',
    anonKey:'anon-test',serviceKey:'service-test',targetRpc:'photo_recovery_target_for_session',
    fetcher:async(url,config)=>{
      calls.push({url,config});
      assert.equal(config.redirect,'error');
      if(url.pathname==='/auth/v1/user')return overrides.auth?.()||json({id:user,is_anonymous:false});
      if(url.pathname.includes('/rest/v1/rpc/')){
        assert.equal(url.pathname,'/rest/v1/rpc/photo_recovery_target_for_session');
        return overrides.target?.()||json(target);
      }
      assert.equal(url.pathname,`/storage/v1/object/sign/fwh-review-private/${path}`);
      return overrides.sign?.()||json({signedURL:`/object/sign/fwh-review-private/${path}?token=short-expiry`});
    }});
  return {handle,calls};
}
test('historical photo recovery shares exact signed URL owner with separately scoped service target',async()=>{
  const {handle,calls}=fixture();
  const response=await handle(request());
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'no-store, private');
  const body=await response.json();
  assert.deepEqual(body,{photo_id:photo,transfer_version:version,
    url:`https://fwh-disposable.supabase.co/storage/v1/object/sign/fwh-review-private/${path}?token=short-expiry`,
    expires_in:120});
  assert.equal(calls.length,3);
  assert.deepEqual(JSON.parse(calls[1].config.body),{
    p_photo:photo,p_transfer_version:version,p_actor:user,p_session:session});
  assert.equal(calls[1].config.headers.Authorization,'Bearer service-test');
  assert.equal(calls[2].config.headers.Authorization,'Bearer service-test');
  assert.deepEqual(JSON.parse(calls[2].config.body),{expiresIn:120});
  assert.ok(!JSON.stringify(body).includes('service-test'));
});
test('recovery refuses client-chosen destination, identity, TTL or untrusted bearer',async()=>{
  for(const data of [{photo_id:photo,transfer_version:version,bucket:'public'},
    {photo_id:photo,transfer_version:version,expires_in:3600},
    {photo_id:photo,transfer_version:version,user_id:user}]){
    const {handle,calls}=fixture();
    assert.equal((await handle(request(data))).status,400);
    assert.equal(calls.length,0);
  }
  const {handle,calls}=fixture();
  assert.equal((await handle(request(undefined,'Bearer fake'))).status,401);
  assert.equal(calls.length,0);
});
test('recovery is not an independent authorization bypass: rejected Auth/target never signs',async()=>{
  const cases=[
    {auth:()=>json({},401)}, {auth:()=>json({id:crypto.randomUUID(),is_anonymous:false})},
    {auth:()=>json({id:user,is_anonymous:true})},
    {target:()=>json({error:'DENIED'},403)},
    {target:()=>json({...target,object_key:`${org}/${wo}/${run}/${crypto.randomUUID()}.jpg`})},
    {target:()=>json({...target,bucket:'public'})},
    {target:()=>json({...target,object_version:''})},
  ];
  for(const config of cases){
    const {handle,calls}=fixture(config);
    const response=await handle(request());
    assert.notEqual(response.status,200);
    assert.equal(calls.filter(c=>c.url.pathname.includes('/object/sign/')).length,0);
    assert.ok(!JSON.stringify(await response.json()).includes('service-test'));
  }
});
test('invalid storage signer reply cannot be used for a cross-path private link',async()=>{
  for(const signedURL of [
    'https://example.invalid/escape?token=x',
    `/object/sign/fwh-review-private/${path}?token=x&expires=86400`,
    `/object/sign/fwh-review-private/${org}/${wo}/${run}/${crypto.randomUUID()}.jpg?token=x`
  ]){
    const {handle}=fixture({sign:()=>json({signedURL})});
    assert.notEqual((await handle(request())).status,200);
  }
});
test('invalid recovery target configuration is rejected during trusted endpoint setup',()=>{
  assert.throws(()=>createPrivatePhotoViewer({url:'https://fwh-disposable.supabase.co',
    anonKey:'anon',serviceKey:'service',targetRpc:'any_user_photo_target'}),/Unapproved/);
});
