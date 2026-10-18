import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveClient,DriveUncertain} from '../../supabase/functions/client-delivery/drive-client.mjs';

const packageId='pkg_'+'a'.repeat(26);
const fileId='file_'+'b'.repeat(26);
const parent='folder_'+'c'.repeat(25);
const hash='a'.repeat(64);
const appProperties={fwh_package:packageId,fwh_manifest:hash};
const metadata={id:fileId,parent,name:'001.jpg',mime:'image/jpeg',appProperties};
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),
  {status,headers:{'Content-Type':'application/json',...headers}});
function fixture(resolver){
  const calls=[];
  const client=createDriveClient({accessToken:'disposable-secret-token-only',
    fetcher:async(url,options)=>{
      calls.push({url:new URL(url),options});
      const response=await resolver(new URL(url),options);
      return response;
    }});
  return {client,calls};
}
const expectCode=async(fn,code)=>assert.rejects(fn,e=>e instanceof DriveUncertain&&e.code===code);
test('Drive generates bounded durable IDs without contacting other origins',async()=>{
  const ids=['generated_'+'1'.repeat(20),'generated_'+'2'.repeat(20)];
  const {client,calls}=fixture((url)=>{assert.equal(url.pathname,'/drive/v3/files/generateIds');
    assert.equal(url.searchParams.get('count'),'2');
    return json({ids});});
  assert.deepEqual(await client.generateIds(2),ids);
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.headers.Authorization,'Bearer disposable-secret-token-only');
  await expectCode(()=>client.generateIds(251),'BOUNDED_ID_REQUEST_REQUIRED');
  assert.equal(calls.length,1);
});
test('folder create keeps preallocated identity and requires independent GET',async()=>{
  const folder={...metadata,mime:'application/vnd.google-apps.folder',name:'DISPOSABLE CLIENT',
    parent};
  const {client,calls}=fixture((url,opts)=>{
    assert.equal(url.pathname,'/drive/v3/files');
    assert.equal(url.searchParams.get('supportsAllDrives'),'true');
    const body=JSON.parse(opts.body);
    assert.equal(body.id,fileId);assert.deepEqual(body.parents,[parent]);
    return json({id:fileId},201);
  });
  assert.deepEqual(await client.createPreallocatedFolder(folder),
    {created_id:fileId,needs_verification:true});
  assert.equal(calls.length,1);
});
test('exact GET with SHA256, size, appProperties, MIME and parent is required',async()=>{
  const {client,calls}=fixture((url)=>{assert.equal(url.pathname,'/drive/v3/files/'+fileId);
    assert.equal(url.searchParams.get('supportsAllDrives'),'true');
    return json({id:fileId,mimeType:'image/jpeg',parents:[parent],size:'250000',sha256Checksum:hash,
      appProperties,trashed:false});});
  assert.deepEqual(await client.verifyFile({id:fileId,parent,mime:'image/jpeg',
    sha256:hash,size:250000,appProperties}),
    {id:fileId,parent,mime:'image/jpeg',sha256:hash,size:250000});
  assert.equal(calls.length,1);
});
test('no missing, altered, trashed, foreign-parent, MIME or unknown-hash file gets receipt',async()=>{
  const broken=[
    {parents:['otherfolder_1234567890123'],code:'REMOTE_FILE_IDENTITY_MISMATCH'},
    {sha256Checksum:undefined,code:'REMOTE_CONTENT_UNVERIFIED'},
    {sha256Checksum:'0'.repeat(64),code:'REMOTE_CONTENT_UNVERIFIED'},
    {size:'249999',code:'REMOTE_CONTENT_UNVERIFIED'},
    {trashed:true,code:'REMOTE_FILE_IDENTITY_MISMATCH'},
    {trashed:undefined,code:'REMOTE_FILE_IDENTITY_MISMATCH'},
    {appProperties:{...appProperties,fwh_manifest:'f'.repeat(64)},code:'REMOTE_FILE_IDENTITY_MISMATCH'},
    {appProperties:{...appProperties,foreign_property:'unauthorized'},code:'REMOTE_FILE_IDENTITY_MISMATCH'},
    {appProperties:{fwh_package:appProperties.fwh_package},code:'REMOTE_FILE_IDENTITY_MISMATCH'},
    {appProperties:null,code:'REMOTE_FILE_IDENTITY_MISMATCH'},
  ];
  for(const {code,...bad} of broken){
    const {client}=fixture(()=>json({id:fileId,mimeType:'image/jpeg',parents:[parent],
      sha256Checksum:hash,size:'250000',appProperties,trashed:false,...bad}));
    await expectCode(()=>client.verifyFile({id:fileId,parent,mime:'image/jpeg',
      sha256:hash,size:250000,appProperties}),code);
  }
  for(const status of [401,403,404,410,409,503]){
    const {client}=fixture(()=>json({error:{message:'Private provider details'}},status));
    await expectCode(()=>client.verifyFile({id:fileId,parent,mime:'image/jpeg',
      sha256:hash,size:250000,appProperties}),
      status===401||status===403?'PROVIDER_AUTH_DENIED'
       :status===404||status===410?'PROVIDER_IDENTITY_UNCERTAIN'
       :status===409?'REMOTE_ID_CONFLICT_RECONCILE':'PROVIDER_RETRY_REQUIRED');
  }
});
test('independent JPEG receipt cannot accept a renamed file or a different client Shared Drive',async()=>{
 const driveId='client_drive_'+'z'.repeat(20);
 const good={id:fileId,name:'001.jpg',mimeType:'image/jpeg',
   parents:[parent],driveId,trashed:false,size:'250000',
   sha256Checksum:hash,appProperties};
 for(const wrong of [
  {name:'someone-else.jpg'},
  {driveId:'different_drive_'+'q'.repeat(20)},
  {driveId:undefined}
 ]){
  const {client}=fixture(()=>json({...good,...wrong}));
  await expectCode(()=>client.verifyFile({id:fileId,parent,
   name:'001.jpg',expectedDriveId:driveId,mime:'image/jpeg',
   sha256:hash,size:250000,appProperties}), 'REMOTE_FILE_IDENTITY_MISMATCH');
 }
 const {client}=fixture(()=>json(good));
 await client.verifyFile({id:fileId,parent,name:'001.jpg',
   expectedDriveId:driveId,mime:'image/jpeg',
   sha256:hash,size:250000,appProperties});
});
test('independent PACKAGE folder GET requires explicit not-trashed and exact properties',async()=>{
  const driveId='client_drive_'+'k'.repeat(20),folderName='package-'+packageId;
  const good={id:fileId,mimeType:'application/vnd.google-apps.folder',
    name:folderName,parents:[parent],driveId,trashed:false,appProperties};
  for(const changed of [
    {trashed:undefined},
    {appProperties:{...appProperties,foreign:'unexpected'}},
    {appProperties:{fwh_package:packageId}},
    {appProperties:null}
  ]){
    const {client}=fixture(()=>json({...good,...changed}));
    await expectCode(()=>client.verifyFile({id:fileId,parent,
      mime:'application/vnd.google-apps.folder',name:folderName,
      expectedDriveId:driveId,sha256:null,size:null,appProperties}),
      'REMOTE_FILE_IDENTITY_MISMATCH');
  }
  const {client}=fixture(()=>json(good));
  const verified=await client.verifyFile({id:fileId,parent,
    mime:'application/vnd.google-apps.folder',name:folderName,
    expectedDriveId:driveId,sha256:null,size:null,appProperties});
  assert.equal(verified.trashed,false);
  assert.equal(verified.drive_id,driveId);
});
test('resumable start pins metadata and rejects any redirected session host',async()=>{
  const good='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=disposableId';
  const {client,calls}=fixture((url,opts)=>{
    assert.equal(url.pathname,'/upload/drive/v3/files');
    assert.equal(url.searchParams.get('supportsAllDrives'),'true');
    assert.equal(url.searchParams.get('uploadType'),'resumable');
    const body=JSON.parse(opts.body);assert.equal(body.id,fileId);
    assert.equal(opts.headers['X-Upload-Content-Length'],'250000');
    return new Response(null,{status:200,headers:{Location:good}});
  });
  assert.deepEqual(await client.startResumable(metadata,{size:250000}),
    {session_url:good,remote_id:fileId,total:250000});
  assert.equal(calls[0].options.redirect,'error');
  const {client:bad}=fixture(()=>new Response(null,{status:200,headers:{
    Location:'https://steal.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=evil'}}));
  await expectCode(()=>bad.startResumable(metadata,{size:250000}),'UNTRUSTED_UPLOAD_SESSION');
});
test('documented Google session URL variants preserve strict host, path and query boundaries',async()=>{
  const allowed=[
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc123',
    'https://www.googleapis.com/resumable/upload/drive/v3/files?uploadType=resumable&upload_id=abc123',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc123&supportsAllDrives=true',
    'https://www.googleapis.com/resumable/upload/drive/v3/files?uploadType=resumable&upload_id=abc123&supportsAllDrives=true&fields=id%2Csize%2Csha256Checksum%2Cparents%2CmimeType%2CappProperties'
  ];
  for(const location of allowed){
    const {client}=fixture(()=>new Response(null,{status:200,headers:{Location:location}}));
    const session=await client.startResumable(metadata,{size:250000});
    assert.equal(session.session_url,location);
    assert.equal(session.remote_id,fileId);
    assert.equal(session.total,250000);
  }
  const denied=[
    ['https://evil.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=x','UNTRUSTED_UPLOAD_SESSION'],
    ['https://www.googleapis.com.evil.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=x','UNTRUSTED_UPLOAD_SESSION'],
    ['http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x','UNTRUSTED_UPLOAD_SESSION'],
    ['https://www.googleapis.com/upload/drive/v3/files/other?uploadType=resumable&upload_id=x','UPLOAD_SESSION_ENDPOINT_UNRECOGNIZED'],
    ['https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x&callback=https%3A%2F%2Fevil.invalid','UPLOAD_SESSION_QUERY_UNRECOGNIZED'],
    ['https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x&upload_id=y','UPLOAD_SESSION_QUERY_UNRECOGNIZED'],
    ['https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x&supportsAllDrives=false','UPLOAD_SESSION_QUERY_UNRECOGNIZED'],
    ['https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x&fields=invalid','UPLOAD_SESSION_QUERY_UNRECOGNIZED']
  ];
  for(const [location,code] of denied){
    const {client}=fixture(()=>new Response(null,{status:200,headers:{Location:location}}));
    await expectCode(()=>client.startResumable(metadata,{size:250000}),code);
  }
});
test('lost responses, expired session, incompatible offset never allow a new file ID',async()=>{
  const url='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test';
  const {client}=fixture(()=>new Response(null,{status:308,headers:{Range:'bytes=0-131071'}}));
  assert.deepEqual(await client.probeResumable(url,250000),{offset:131072,complete_candidate:false});
  for(const range of ['bytes=7-12','bytes=0-250000']){
    const {client:broken}=fixture(()=>new Response(null,{status:308,headers:{Range:range}}));
    await expectCode(()=>broken.probeResumable(url,250000),'RESUMABLE_OFFSET_UNCERTAIN');
  }
  const {client:expired}=fixture(()=>json({},410));
  await expectCode(()=>expired.probeResumable(url,250000),'PROVIDER_IDENTITY_UNCERTAIN');
  await expectCode(()=>client.probeResumable('https://attacker.invalid/test',250000),'UNTRUSTED_UPLOAD_SESSION');
});
test('chunked upload is bounded, unaligned ranges rejected, 308 is not receipt',async()=>{
  const url='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test';
  const {client,calls}=fixture((url,opts)=>{
    assert.equal(opts.headers['Content-Range'],'bytes 0-262143/524288');
    return new Response(null,{status:308,headers:{Range:'bytes=0-262143'}});
  });
  assert.deepEqual(await client.uploadChunk(url,524288,0,new Uint8Array(262144)),
    {complete_candidate:false,requires_get_verification:true});
  await expectCode(()=>client.uploadChunk(url,524288,0,new Uint8Array(10)),'INVALID_UPLOAD_RANGE');
  assert.equal(calls.length,1);
});

test('configured Workspace identity requires exact OAuth about.get owner',async()=>{
  const {client,calls}=fixture(url=>{
    assert.equal(url.pathname,'/drive/v3/about');
    assert.equal(url.searchParams.get('fields'),'user(emailAddress,permissionId,me)');
    return json({user:{emailAddress:'office@example.invalid',permissionId:'drive_permission_1',me:true}});
  });
  assert.deepEqual(await client.verifyProviderIdentity('office@example.invalid'),
    {account:'office@example.invalid',permission_id:'drive_permission_1'});
  await expectCode(()=>client.verifyProviderIdentity('different@example.invalid'),'WORKSPACE_ACCOUNT_MISMATCH');
  assert.equal(calls.length,2);
});
test('destination verification requires a real accessible folder, correct drive and write capability',async()=>{
  const driveId='drive_'+'d'.repeat(26);
  const good={id:parent,mimeType:'application/vnd.google-apps.folder',
    driveId,trashed:false,capabilities:{canAddChildren:true}};
  for(const failure of [
    {capabilities:{canAddChildren:false}},
    {mimeType:'image/jpeg'},{trashed:true},{driveId:'some_other_drive'},
    {capabilities:undefined}
  ]){
    const {client}=fixture(()=>json({...good,...failure}));
    await expectCode(()=>client.verifyDestination({folderId:parent,expectedDriveId:driveId}),
      'DESTINATION_NOT_VERIFIED');
  }
  const {client}=fixture(url=>{
    assert.equal(url.searchParams.get('supportsAllDrives'),'true');
    assert.match(url.searchParams.get('fields'),/capabilities\(canAddChildren\)/);
    return json(good);
  });
  assert.deepEqual(await client.verifyDestination({folderId:parent,expectedDriveId:driveId}),
    {id:parent,drive_id:driveId,can_add_children:true});
});
test('ambiguous transport failure never authorizes blind remote create or replacement ID',async()=>{
  const {client,calls}=fixture(()=>{throw new Error('provider network lost after create');});
  await expectCode(()=>client.createPreallocatedFolder({...metadata,
    mime:'application/vnd.google-apps.folder',name:'DISPOSABLE FOLDER'}),'PROVIDER_OUTCOME_UNCERTAIN');
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.redirect,'error');
});

test('geographic parent create accepts only exact scoped five-property identity',async()=>{
  const scoped={fwh_org:'00000000-0000-4000-8000-000000000001',
    fwh_company:'00000000-0000-4000-8000-000000000002',
    fwh_destination:'00000000-0000-4000-8000-000000000003',
    fwh_kind:'COUNTY',fwh_key:'a'.repeat(64)};
  const id='geo_'+'x'.repeat(25);
  const spec={id,parent,name:'Beckham County',
    mime:'application/vnd.google-apps.folder',appProperties:scoped};
  const {client,calls}=fixture((url,opts)=>{
    assert.equal(url.pathname,'/drive/v3/files');
    assert.deepEqual(JSON.parse(opts.body).appProperties,scoped);
    return json({id},201);
  });
  assert.equal((await client.createPreallocatedFolder(spec)).created_id,id);
  await expectCode(()=>client.createPreallocatedFolder({
    ...spec,appProperties:{...scoped,fwh_company:'not-a-uuid'}}),'EXACT_APP_PROPERTIES_REQUIRED');
  await expectCode(()=>client.createPreallocatedFolder({
    ...spec,appProperties:{...scoped,unexpected:'extra'}}),'EXACT_APP_PROPERTIES_REQUIRED');
  await expectCode(()=>client.startResumable({...spec,mime:'image/jpeg'},{size:123}),
    'EXACT_APP_PROPERTIES_REQUIRED');
  assert.equal(calls.length,1);
});
