import test from 'node:test';
import assert from 'node:assert/strict';
import {runDisposableFolderProbe,validateProofConfiguration,FolderProbeBlocked}
  from '../../ci/probe_phase5_workspace_folder.mjs';

const root='root_'+'r'.repeat(24);
const clientDrive='drive_'+'d'.repeat(24);
const internal='internal_'+'i'.repeat(22);
const folderId='preallocated_'+'p'.repeat(18);
const email='office@disposable.invalid';
const token='disposable-access-token-0123456789012';
const env={
 FWH_TEST_EVIDENCE_CLASS:'DISPOSABLE_FWH_TEST_ONLY',
 FWH_TEST_WORKSPACE_EMAIL:email,
 FWH_TEST_WORKSPACE_DOMAIN:'disposable.invalid',
 FWH_TEST_INTERNAL_SHARED_DRIVE_ID:internal,
 FWH_TEST_CLIENT_SHARED_DRIVE_ID:clientDrive,
 FWH_TEST_CLIENT_ROOT_FOLDER_ID:root,
 FWH_TEST_WORKSPACE_CLIENT_ID:'synthetic-client-id-only-1234',
 FWH_TEST_WORKSPACE_CLIENT_SECRET:'synthetic-client-secret-only-1234',
 FWH_TEST_WORKSPACE_REFRESH_TOKEN:'synthetic-refresh-token-only-1234',
 FWH_TEST_WORKSPACE_SCOPE:'https://www.googleapis.com/auth/drive'
};
const response=(obj,status=200)=>Response.json(obj,{status});
function fixture({lostPost=false,wrongRoot=false,wrongDrive=false,
                    lookupMissing=false,missingGet=false}={}){
 let persisted=null,remote=null,postCount=0;
 const methods=[];
 const journal={
  async read(){return persisted;},
  async reserve(v){if(persisted!==null)throw Error('not exclusive');persisted=v;}
 };
 const fetcher=async(url,opt={})=>{
  const u=new URL(url);
  const method=opt.method||'GET';
  methods.push(method+' '+u.pathname);
  if(u.origin==='https://oauth2.googleapis.com'){
   assert.equal(u.pathname,'/token');
   assert.equal(method,'POST');
   return response({access_token:token,token_type:'Bearer',
     expires_in:3600,scope:env.FWH_TEST_WORKSPACE_SCOPE});
  }
  assert.equal(u.origin,'https://www.googleapis.com');
  assert.equal(opt.redirect,'error');
  assert.equal(opt.headers.Authorization,'Bearer '+token);
  if(u.pathname==='/drive/v3/about')
    return response({user:{emailAddress:email,me:true,permissionId:'permission-1'}});
  if(u.pathname==='/drive/v3/files/'+root
    ||u.pathname==='/drive/v3/files/'+'root_'+'x'.repeat(24))
    return response({id:u.pathname.slice('/drive/v3/files/'.length),
      mimeType:'application/vnd.google-apps.folder',
      driveId:wrongRoot?internal:clientDrive,trashed:false,
      capabilities:{canAddChildren:true}});
  if(u.pathname==='/drive/v3/files/generateIds'){
    assert.equal(method,'GET');
    assert.equal(u.searchParams.get('count'),'1');
    return response({ids:[folderId]});
  }
  if(u.pathname==='/drive/v3/files'&&method==='POST'){
    postCount++;
    assert.equal(u.searchParams.get('supportsAllDrives'),'true');
    const data=JSON.parse(opt.body);
    assert.equal(data.id,folderId);
    assert.deepEqual(data.parents,[root]);
    assert.equal(data.mimeType,'application/vnd.google-apps.folder');
    assert.match(data.name,/^FWH DISPOSABLE TEST [0-9a-f]{12}$/);
    assert.deepEqual(Object.keys(data.appProperties).sort(),
      ['fwh_org','fwh_company','fwh_destination','fwh_kind','fwh_key'].sort());
    remote={...data,driveId:wrongDrive?internal:clientDrive,trashed:false};
    if(lostPost)throw Error('Lost POST response after provider commit and secret');
    return response({id:folderId},201);
  }
  if(u.pathname==='/drive/v3/files/'+folderId){
    if(missingGet||remote===null)return response({},404);
    return response(remote);
  }
  if(u.pathname==='/drive/v3/files'&&method==='GET'){
    assert.equal(u.searchParams.get('driveId'),clientDrive);
    assert.equal(u.searchParams.get('corpora'),'drive');
    assert.equal(u.searchParams.get('supportsAllDrives'),'true');
    assert.equal(u.searchParams.get('includeItemsFromAllDrives'),'true');
    assert.match(u.searchParams.get('q'),/in parents and name =/);
    return response({files:lookupMissing?[]:[remote]});
  }
  throw Error('unexpected external request '+method+' '+u.pathname);
 };
 return {journal,fetcher,methods,postCount:()=>postCount,saved:()=>persisted};
}
test('bad TEST marker, Workspace identity, or internal Drive alias blocks before network',async()=>{
 for(const changed of [
  {FWH_TEST_EVIDENCE_CLASS:'PRODUCTION'},
  {FWH_TEST_WORKSPACE_EMAIL:'wrong@outside.invalid'},
  {FWH_TEST_CLIENT_SHARED_DRIVE_ID:internal},
  {FWH_TEST_CLIENT_ROOT_FOLDER_ID:clientDrive}
 ]){
  const f=fixture();
  await assert.rejects(()=>runDisposableFolderProbe({
   env:{...env,...changed},fetcher:f.fetcher,journal:f.journal,mode:'execute'
  }),FolderProbeBlocked);
  assert.deepEqual(f.methods,[]);
 }
 assert.equal(validateProofConfiguration(env).clientDrive,clientDrive);
});
test('preflight is read-only and never reserves a remote folder',async()=>{
 const f=fixture();
 const r=await runDisposableFolderProbe({env,fetcher:f.fetcher,
   journal:f.journal,mode:'preflight'});
 assert.deepEqual(r,{status:'TEST_ROOT_REVERIFIED',writes:false});
 assert.equal(f.saved(),null);
 assert.equal(f.postCount(),0);
 assert.deepEqual(f.methods.map(x=>x.split(' ')[0]),['POST','GET','GET']);
});
test('one permitted POST uses preallocated durable ID, then GET and scoped LIST',async()=>{
 const f=fixture();
 const a=await runDisposableFolderProbe({env,fetcher:f.fetcher,
   journal:f.journal,mode:'execute'});
 assert.deepEqual(a,{status:'TEST_FOLDER_CREATED_AND_VERIFIED',writes:true});
 assert.equal(f.saved().spec.id,folderId);
 assert.equal(f.postCount(),1);
 assert.deepEqual(f.methods.map(x=>x.split(' ')[0]),
   ['POST','GET','GET','GET','POST','GET','GET']);
 const b=await runDisposableFolderProbe({env,fetcher:f.fetcher,
   journal:f.journal,mode:'execute'});
 assert.deepEqual(b,{status:'SAME_TEST_FOLDER_REVERIFIED',writes:false});
 assert.equal(f.postCount(),1,'re-running --execute NEVER creates a second folder');
});
test('unknown POST response can only recover through independent original-ID GET',async()=>{
 const f=fixture({lostPost:true});
 const v=await runDisposableFolderProbe({env,fetcher:f.fetcher,
   journal:f.journal,mode:'execute'});
 assert.deepEqual(v,{status:'TEST_FOLDER_CREATED_AND_VERIFIED',writes:true});
 assert.equal(f.postCount(),1);
 const recovered=await runDisposableFolderProbe({env,fetcher:f.fetcher,
   journal:f.journal,mode:'verify'});
 assert.equal(recovered.status,'SAME_TEST_FOLDER_REVERIFIED');
 assert.equal(f.postCount(),1);
});
test('unverified response, wrong parent/drive, absent lookup stop and never blind retry',async()=>{
 for(const mode of ['wrongRoot','wrongDrive','lookupMissing','missingGet']){
  const f=fixture({[mode]:true});
  await assert.rejects(()=>runDisposableFolderProbe({env,fetcher:f.fetcher,
    journal:f.journal,mode:'execute'}));
  const writes=f.postCount();
  await assert.rejects(()=>runDisposableFolderProbe({env,fetcher:f.fetcher,
    journal:f.journal,mode:'verify'}));
  assert.equal(f.postCount(),writes);
 }
});
test('explicit verification without any original journal cannot create',async()=>{
 const f=fixture();
 await assert.rejects(()=>runDisposableFolderProbe({env,fetcher:f.fetcher,
  journal:f.journal,mode:'verify'}),e=>e instanceof FolderProbeBlocked
   &&e.code==='NO_ORIGINAL_PROBE_TO_VERIFY');
 assert.equal(f.postCount(),0);
});
test('saved identity drift between client destinations fails before a write',async()=>{
 const f=fixture();
 await runDisposableFolderProbe({env,fetcher:f.fetcher,
   journal:f.journal,mode:'execute'});
 const other={...env,FWH_TEST_CLIENT_ROOT_FOLDER_ID:'root_'+'x'.repeat(24)};
 await assert.rejects(()=>runDisposableFolderProbe({env:other,fetcher:f.fetcher,
   journal:f.journal,mode:'execute'}),FolderProbeBlocked);
 assert.equal(f.postCount(),1);
});

test('journal reservation failure blocks BEFORE any remote folder POST',async()=>{
 const f=fixture();
 f.journal.reserve=async()=>{throw Error('simulated full disk before durable reservation');};
 await assert.rejects(()=>runDisposableFolderProbe({env,fetcher:f.fetcher,
   journal:f.journal,mode:'execute'}));
 assert.equal(f.postCount(),0);
 assert.equal(f.saved(),null);
});
