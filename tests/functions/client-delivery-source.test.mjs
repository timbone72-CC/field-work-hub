import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPrivateSourceChunkReader}
  from '../../supabase/functions/client-delivery/private-source.mjs';
import {DriveUncertain}
  from '../../supabase/functions/client-delivery/drive-client.mjs';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const projectUrl='https://vyocaujuwrivoqynvitm.supabase.co';
const token='service.test.jwt';
const photoId=uuid(4), packageId=uuid(5), planId=uuid(6);
const objectKey=[uuid(1),uuid(2),uuid(3),photoId+'.jpg'].join('/');
const photo={
 package_id:packageId,plan_id:planId,kind:'PHOTO',photo_id:photoId,
 file_id:'generated_'+'a'.repeat(24),parent_id:'folder_'+'b'.repeat(24),
 name:'001.jpg',mime:'image/jpeg',size:300000,sha256:'a'.repeat(64),
 appProperties:{fwh_package:packageId,fwh_manifest:'b'.repeat(64)},
 source:{bucket:'fwh-review-private',object_key:objectKey,
   object_id:uuid(7),object_version:'V1',owner_id:uuid(8),photo_id:photoId,
   transfer_version:uuid(9)}
};
const unavailable=e=>e instanceof DriveUncertain
   &&e.code==='PROTECTED_SOURCE_CHUNK_UNAVAILABLE';
function rig({fresh=photo,afterward=null,bytes=new Uint8Array(262144),status=206,
  headers={},error=false,record=[]}={}){
 let projections=0;
 const ledger={getFilePlan:async id=>{
   record.push(['projection',id]);
   if(error)throw Error('STALE_OR_REVOKED_LEASE_PRIVATE');
   return projections++===0?fresh:(afterward??fresh);
 }};
 const fetcher=async (url,request)=>{
   record.push(['storage',url,request]);
   return new Response(bytes,{status,headers:{
     'Content-Type':'image/jpeg',
     'Content-Range':'bytes 0-262143/300000',
     'Content-Length':String(bytes.length),
     ...headers
   }});
 };
 const read=createPrivateSourceChunkReader({projectUrl,serviceRoleJwt:token,
   ledger,fetcher});
 return {read,record};
}
test('reads only the private server-projected object with an exact bounded byte range',async()=>{
 const r=rig();
 const bytes=await r.read(photo,0,262144);
 assert.equal(bytes.length,262144);
 assert.deepEqual(r.record.map(x=>x[0]),['projection','storage','projection']);
 const request=r.record[1][2],uri=new URL(r.record[1][1]);
 assert.equal(uri.origin,projectUrl);
 assert.equal(uri.pathname,'/storage/v1/object/authenticated/fwh-review-private/'+objectKey);
 assert.equal(uri.search,'');
 assert.equal(request.redirect,'error');
 assert.equal(request.method,'GET');
 assert.equal(request.headers.Range,'bytes=0-262143');
 assert.equal(request.headers.Authorization,'Bearer '+token);
 assert.equal(request.headers.apikey,token);
 assert.equal(request.headers['Accept-Encoding'],'identity');
});
test('second photo chunk requires an exact 206 and catalog recheck as well',async()=>{
 const r=rig({bytes:new Uint8Array(37856),
   headers:{'Content-Range':'bytes 262144-299999/300000',
     'Content-Length':'37856'}});
 assert.equal((await r.read(photo,262144,37856)).length,37856);
 assert.equal(r.record[1][2].headers.Range,'bytes=262144-299999');
 assert.deepEqual(r.record.map(x=>x[0]),['projection','storage','projection']);
});
test('catalog changes or revoked lease during a byte read prevent client-bound bytes',async()=>{
 const r=rig({afterward:{...photo,source:{...photo.source,object_version:'V2'}}});
 await assert.rejects(()=>r.read(photo,0,262144),unavailable);
 assert.deepEqual(r.record.map(x=>x[0]),['projection','storage','projection']);
});
test('stale owner/lease, new file plan or altered catalog source cannot read any bytes',async()=>{
 const modified=[
  {...photo,source:{...photo.source,bucket:'other-bucket'}},
  {...photo,source:{...photo.source,object_key:objectKey+'/nested'}},
  {...photo,source:{...photo.source,object_key:objectKey.replace(photoId,uuid(11))}},
  {...photo,source:{...photo.source,owner_id:'not-a-uuid'}},
  {...photo,source:{...photo.source,transfer_version:uuid(10),photo_id:uuid(10)}},
  {...photo,sha256:'c'.repeat(64)},
  {...photo,file_id:'foreign_file'},
  {...photo,appProperties:{...photo.appProperties,fwh_package:uuid(90)}}
 ];
 for(const fresh of modified){
  const r=rig({fresh});
  await assert.rejects(()=>r.read(photo,0,262144),unavailable);
  assert.deepEqual(r.record.map(x=>x[0]),['projection']);
 }
 const revoked=rig({error:true});
 await assert.rejects(()=>revoked.read(photo,0,262144),unavailable);
 assert.deepEqual(revoked.record.map(x=>x[0]),['projection']);
});
test('rejects missing, partial, oversized, mismatched or redirected Storage responses',async()=>{
 const cases=[
  {status:200},
  {status:404},
  {status:302},
  {headers:{'Content-Range':'bytes 0-262142/300000'}},
  {headers:{'Content-Range':'bytes 0-262143/300001'}},
  {headers:{'Content-Type':'application/octet-stream'}},
  {headers:{'Content-Encoding':'gzip'}},
  {headers:{'Content-Length':'262143'}},
  {bytes:new Uint8Array(1000)},
  {bytes:new Uint8Array(262145)}
 ];
 for(const option of cases){
  const r=rig(option);
  await assert.rejects(()=>r.read(photo,0,262144),unavailable);
  assert.deepEqual(r.record.map(x=>x[0]),['projection','storage']);
 }
});
test('only bounded exact ranges may reach service Storage with bearer credentials',async()=>{
 const r=rig();
 for(const [offset,size] of [[-1,1],[0,0],[0,262145],[299999,2],
  [300000,1],[Number.NaN,1]]){
   await assert.rejects(()=>r.read(photo,offset,size),unavailable);
 }
 assert.deepEqual(r.record,[]);
});
test('manifest source is canonical exact SHA-256 bytes without Storage download',async()=>{
 const manifest='{"package_id":"'+packageId+'","selected_photos":[]}';
 const bytes=new TextEncoder().encode(manifest);
 const digest=createHash('sha256').update(bytes).digest('hex');
 const signed={...photo,kind:'MANIFEST',photo_id:null,name:'submission.json',
  mime:'application/json',size:bytes.length,sha256:digest,
  source:{manifest_bytes:manifest}};
 const events=[],r=rig({fresh:signed,record:events});
 const first=await r.read(signed,0,7);
 const rest=await r.read(signed,7,bytes.length-7);
 assert.equal(new TextDecoder().decode(first)+new TextDecoder().decode(rest),manifest);
 assert.deepEqual(events.map(x=>x[0]),['projection','projection']);
 for(const corrupted of [
  {...signed,source:{manifest_bytes:manifest+' '}},
  {...signed,source:{manifest_bytes:manifest.replace('[]','[1]')}},
  {...signed,source:{manifest_bytes:''}}
 ]){
  const bad=rig({fresh:corrupted});
  await assert.rejects(()=>bad.read(signed,0,7),unavailable);
 }
});
test('rejects untrusted Supabase origin and missing service lease/JWT at construction',()=>{
 for(const origin of [
  'http://vyocaujuwrivoqynvitm.supabase.co',
  'https://vyocaujuwrivoqynvitm.supabase.co.evil.example',
  'https://user@vyocaujuwrivoqynvitm.supabase.co',
  'https://vyocaujuwrivoqynvitm.supabase.co/storage/v1'
 ]){
  assert.throws(()=>createPrivateSourceChunkReader({projectUrl:origin,
    serviceRoleJwt:token,ledger:{getFilePlan:async()=>photo}}),unavailable);
 }
 for(const props of [
  {projectUrl,serviceRoleJwt:'sb_publishable_not_secret',ledger:{getFilePlan:async()=>photo}},
  {projectUrl,serviceRoleJwt:token,ledger:{}}
 ]){
  assert.throws(()=>createPrivateSourceChunkReader(props),unavailable);
 }
});
