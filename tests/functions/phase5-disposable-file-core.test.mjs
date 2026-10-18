import test from 'node:test';
import assert from 'node:assert/strict';
import {runDisposableFileProof,runApprovedReplacementFileProof,
  runApprovedThirdFileProof,FileProofBlocked}
  from '../../ci/phase5_disposable_file_core.mjs';

const driveId='disposable_client_drive_123456';
const folderId='disposable_folder_1234567890';
const rootId='disposable_root_1234567890123';
const config={testOnly:true,driveId,folderId,rootId,email:'tester@disposable.invalid'};
const fileId='disposable_file_123456789012';
const replacementId='separate_replacement_file_20261017';
function rig({failStart=false,wrongAccount=false,wrongFolder=false,failFinal=false,generatedFileId=fileId}={}){
  const events=[];
  let saved=null,offset=0,started=0;
  const journal={
    async read(){events.push('read');return saved&&{...saved};},
    async reserve(row){events.push('reserve');assert.equal(saved,null);saved={...row};},
    async update(row){events.push('update:'+row.state);saved={...row};}
  };
  const drive={
    async verifyProviderIdentity(email){events.push('account');return {account:wrongAccount?'other@disposable.invalid':email};},
    async verifyDestination({folderId:id,expectedDriveId}){events.push('destination:'+id);
      assert.equal(expectedDriveId,driveId);
      if(wrongFolder&&id===folderId)throw Error('foreign TEST parent');
      return {id,drive_id:driveId,can_add_children:true};
    },
    async generateIds(n){events.push('generate');assert.equal(n,1);return [generatedFileId];},
    async startResumable(spec,{size}){events.push('POST:start');
      assert.equal(saved.state,'START_ATTEMPTED','one-shot journal saved before POST');
      assert.equal(spec.id,generatedFileId);assert.equal(spec.parent,folderId);
      assert.equal(spec.mime,'application/json');assert.equal(size,saved.size);
      started++;
      if(failStart)throw Error('Google may have created a file before lost reply');
      return {remote_id:generatedFileId,total:size,session_url:
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=proof'};
    },
    async probeResumable(session,total){events.push('probe');
      assert.equal(session,saved.session_url,'journal session must be stored');
      return offset===total?{complete_candidate:true,requires_get_verification:true}
        :{offset,complete_candidate:false};
    },
    async uploadChunk(session,total,from,bytes){events.push('PUT:'+from);
      assert.equal(saved.session_url,session);
      assert.equal(from,offset);
      if(from===0)assert.equal(saved.state,'SESSION_READY');
      assert.equal(bytes.length,Math.min(262144,total-from));
      offset+=bytes.length;
      return {complete_candidate:offset===total,requires_get_verification:true};
    },
    async verifyFile(expected){events.push('GET:receipt');
      assert.equal(expected.id,generatedFileId);assert.equal(expected.parent,folderId);
      assert.equal(expected.mime,'application/json');
      assert.equal(expected.expectedDriveId,driveId);
      assert.equal(expected.appProperties.fwh_manifest,saved.sha256);
      assert.equal(expected.name,'FWH_DISPOSABLE_'+saved.test_id+'.json');
      if(failFinal||offset!==saved.size)throw Error('remote checksum unverified');
      return {id:generatedFileId,parent:folderId,mime:'application/json',
        sha256:saved.sha256,size:saved.size};
    }
  };
  return {drive,journal,events,setSaved:value=>{saved=value;},
    getSaved:()=>saved,starts:()=>started,offset:()=>offset};
}
const run=(r,mode,c=config)=>runDisposableFileProof({config:c,drive:r.drive,journal:r.journal,mode});
test('explicit read-only preparation never creates IDs or file bytes',async()=>{
 const r=rig();
 assert.deepEqual(await run(r,'prepare'),{status:'TEST_FILE_PARENT_VERIFIED',writes:false});
 assert.deepEqual(r.events,['account','destination:'+rootId,'destination:'+folderId]);
 assert.equal(r.getSaved(),null);
});
test('the first invocation persists one immutable ID and one session before the first 256KiB',async()=>{
 const r=rig();
 assert.deepEqual(await run(r,'begin'),{status:'TEST_FIRST_CHUNK_CONFIRMED',writes:true});
 assert.equal(r.starts(),1);
 assert.equal(r.offset(),262144);
 assert.equal(r.getSaved().state,'CHUNK_SENT');
 assert.deepEqual(r.events.filter(x=>/^(reserve|update:|POST:start|PUT:)/.test(x)),[
  'reserve','update:START_ATTEMPTED','POST:start','update:SESSION_READY',
  'PUT:0','update:CHUNK_SENT'
 ]);
 await assert.rejects(()=>run(r,'begin'),e=>
   e instanceof FileProofBlocked&&e.code==='TEST_FILE_ALREADY_RESERVED');
 assert.equal(r.starts(),1,'already-reserved proof cannot start a second file');
});
test('a resumed invocation uses only the saved session/ID and confirms remote content',async()=>{
 const r=rig();
 await run(r,'begin');
 assert.deepEqual(await run(r,'resume'),{status:'TEST_FILE_SHA256_VERIFIED',writes:true});
 assert.equal(r.getSaved().state,'VERIFIED');
 assert.equal(r.offset(),r.getSaved().size);
 assert.equal(r.starts(),1);
 assert.deepEqual(await run(r,'verify'),{status:'SAME_TEST_FILE_VERIFIED',writes:false});
 assert.equal(r.starts(),1);
});
test('lost session initiation cannot blindly start a new session or file ID',async()=>{
 const r=rig({failStart:true});
 await assert.rejects(()=>run(r,'begin'),/Google may have created/);
 assert.equal(r.getSaved().state,'START_ATTEMPTED');
 await assert.rejects(()=>run(r,'resume'),e=>
  e instanceof FileProofBlocked&&e.code==='TEST_SESSION_UNCERTAIN_NO_RECREATE');
 await assert.rejects(()=>run(r,'verify'),/remote checksum unverified/);
 assert.equal(r.starts(),1);
 assert.equal(r.events.filter(x=>x==='generate').length,1);
});
test('independent exact original-ID GET can reconcile an uncertain start only if remote bytes really match',async()=>{
 const r=rig({failStart:true});
 await assert.rejects(()=>run(r,'begin'));
 const unknown=r.getSaved();
 // Fake provider completes after lost reply; same immutable content/ID persists.
 r.setSaved({...unknown,state:'START_ATTEMPTED'});
 // New rig simulates successful exact remote proof of the same saved ID.
 const completed=rig();
 completed.setSaved({...unknown});
 await run(completed,'prepare');
 // Strict remote verifier is modeled by only accepting the original saved
 // SHA/size/parent/id, without a provider POST (separate Drive adapter tests).
 completed.drive.verifyFile=async input=>{
  completed.events.push('GET:receipt');assert.equal(input.id,unknown.file_id);
  assert.equal(input.sha256,unknown.sha256);return {id:input.id};
 };
 assert.deepEqual(await run(completed,'verify'),{status:'SAME_TEST_FILE_VERIFIED',writes:false});
 assert.equal(completed.starts(),0);
 assert.equal(completed.getSaved().state,'VERIFIED');
});
test('read-only original-ID inspection reports bounded uncertainty and does not change an attempted journal',async()=>{
 const r=rig({failStart:true});
 await assert.rejects(()=>run(r,'begin'));
 const original=JSON.stringify(r.getSaved()),before=r.events.length;
 r.drive.verifyFile=async expected=>{
  r.events.push('GET:receipt');
  assert.equal(expected.id,r.getSaved().file_id);
  assert.equal(expected.parent,folderId);
  assert.equal(expected.expectedDriveId,driveId);
  const error=new Error('private Google error and credentials must never surface');
  error.code='PROVIDER_IDENTITY_UNCERTAIN';
  throw error;
 };
 assert.deepEqual(await run(r,'inspect'),{
  status:'ORIGINAL_FILE_NOT_VERIFIED',reason:'PROVIDER_IDENTITY_UNCERTAIN',
  writes:false,verified:false
 });
 assert.equal(JSON.stringify(r.getSaved()),original);
 assert.deepEqual(r.events.slice(before),[
  'account','destination:'+rootId,'destination:'+folderId,'read','GET:receipt'
 ]);
 assert.equal(r.starts(),1);
});
test('exact original GET can report verified without writing or marking journal',async()=>{
 const r=rig({failStart:true});
 await assert.rejects(()=>run(r,'begin'));
 const original=JSON.stringify(r.getSaved());
 r.drive.verifyFile=async expected=>{
  r.events.push('GET:receipt');
  assert.equal(expected.id,r.getSaved().file_id);
  assert.equal(expected.sha256,r.getSaved().sha256);
  return {id:expected.id};
 };
 assert.deepEqual(await run(r,'inspect'),{
  status:'ORIGINAL_FILE_EXACT_GET_VERIFIED',writes:false,verified:true
 });
 assert.equal(JSON.stringify(r.getSaved()),original);
 assert.equal(r.starts(),1);
});
test('wrong Workspace identity, wrong separate TEST folder, modified journal all fail closed',async()=>{
 const a=rig({wrongAccount:true});
 await assert.rejects(()=>run(a,'begin'),e=>
   e instanceof FileProofBlocked&&e.code==='WORKSPACE_IDENTITY_UNCERTAIN');
 assert.equal(a.events.includes('generate'),false);
 const b=rig({wrongFolder:true});
 await assert.rejects(()=>run(b,'begin'),/foreign TEST parent/);
 assert.equal(b.events.includes('generate'),false);
 const c=rig();await run(c,'begin');
 c.setSaved({...c.getSaved(),file_id:'BAD'});
 await assert.rejects(()=>run(c,'resume'),e=>
   e instanceof FileProofBlocked&&e.code==='SAVED_TEST_FILE_UNCERTAIN');
});
test('unverified final remote content never makes a durable VERIFIED journal',async()=>{
 const r=rig({failFinal:true});
 await run(r,'begin');
 await assert.rejects(()=>run(r,'resume'),/remote checksum unverified/);
 assert.equal(r.getSaved().state,'CHUNK_SENT');
 assert.equal(r.starts(),1);
});
test('non TEST configuration and duplicate internal/client root fail before network',async()=>{
 const r=rig();
 await assert.rejects(()=>run(r,'begin',{...config,testOnly:false}),e=>
   e instanceof FileProofBlocked&&e.code==='DISPOSABLE_TEST_CONFIGURATION_REQUIRED');
 await assert.rejects(()=>run(r,'begin',{...config,rootId:driveId}),e=>
   e instanceof FileProofBlocked&&e.code==='DISPOSABLE_TEST_CONFIGURATION_REQUIRED');
 assert.deepEqual(r.events,[]);
});

test('CLI refuses missing/unknown mode without reading private receipts or invoking provider',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const script=fileURLToPath(new URL('../../ci/probe_phase5_workspace_file.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,'--unrecognized'],{
    encoding:'utf8',timeout:5000,env:{...process.env,
      FWH_GOOGLE_OAUTH_REFRESH_TOKEN:'DO_NOT_PRINT_TEST_TOKEN'}
  });
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr.trim(),'BLOCKED: VALID_TEST_MODE_REQUIRED');
  assert.equal(result.stderr.includes('DO_NOT_PRINT_TEST_TOKEN'),false);
});

const runReplacement=(original,second,mode,c=config)=>
  runApprovedReplacementFileProof({config:c,drive:second.drive,
    originalJournal:original.journal,replacementJournal:second.journal,mode});

test('operator-approved replacement completes one different TEST ID and preserves failed original',async()=>{
 const original=rig({failStart:true});
 await assert.rejects(()=>run(original,'begin'));
 const saved=JSON.stringify(original.getSaved());
 const second=rig({generatedFileId:replacementId});
 assert.deepEqual(await runReplacement(original,second,'prepare'),
   {status:'TEST_FILE_PARENT_VERIFIED',writes:false});
 const completed=await runReplacement(original,second,'complete');
 assert.equal(completed.status,'TEST_REPLACEMENT_FILE_SHA256_VERIFIED');
 assert.equal(second.starts(),1);
 assert.equal(second.getSaved().state,'VERIFIED');
 assert.equal(second.getSaved().file_id,replacementId);
 assert.equal(JSON.stringify(original.getSaved()),saved);
 assert.equal(original.starts(),1);
 const before=second.events.filter(x=>x==='POST:start').length;
 assert.equal((await runReplacement(original,second,'complete')).status,
   'TEST_REPLACEMENT_FILE_SHA256_VERIFIED');
 assert.equal(second.events.filter(x=>x==='POST:start').length,before);
});

test('replacement lost start response becomes a new permanent one-shot stop',async()=>{
 const original=rig({failStart:true});
 await assert.rejects(()=>run(original,'begin'));
 const saved=JSON.stringify(original.getSaved());
 const second=rig({failStart:true,generatedFileId:replacementId});
 await assert.rejects(()=>runReplacement(original,second,'complete'),
   /Google may have created/);
 assert.equal(second.getSaved().state,'START_ATTEMPTED');
 assert.equal(second.getSaved().session_url,null);
 await assert.rejects(()=>runReplacement(original,second,'complete'),error=>
   error instanceof FileProofBlocked&&error.code==='REPLACEMENT_SESSION_UNCERTAIN_NO_RECREATE');
 assert.equal(second.starts(),1);
 assert.equal(JSON.stringify(original.getSaved()),saved);
});

test('replacement refuses generating original Google file ID even for TEST',async()=>{
 const original=rig({failStart:true});
 await assert.rejects(()=>run(original,'begin'));
 const second=rig();
 second.drive.generateIds=async()=>{
   second.events.push('generate');return [original.getSaved().file_id];
 };
 await assert.rejects(()=>runReplacement(original,second,'complete'),error=>
   error instanceof FileProofBlocked&&error.code==='TEST_FILE_ID_UNAVAILABLE');
 assert.equal(second.getSaved(),null);
 assert.equal(second.starts(),0);
});

test('replacement refuses missing or modified/other-state original attempt',async()=>{
 const original=rig(),second=rig();
 await assert.rejects(()=>runReplacement(original,second,'complete'),error=>
   error instanceof FileProofBlocked&&error.code==='ORIGINAL_TEST_JOURNAL_REQUIRED');
 assert.equal(second.events.length,0);
 await run(original,'begin');
 await assert.rejects(()=>runReplacement(original,second,'complete'),error=>
   error instanceof FileProofBlocked&&error.code==='ORIGINAL_TEST_ATTEMPT_REQUIRED');
 assert.equal(second.events.length,0);
 original.setSaved({...original.getSaved(),folder_id:'different_root_file_identity'});
 await assert.rejects(()=>runReplacement(original,second,'complete'),error=>
   error instanceof FileProofBlocked&&error.code==='SAVED_TEST_FILE_UNCERTAIN');
 assert.equal(second.events.length,0);
});

test('replacement VERIFY cannot initiate and requires its own independent journal',async()=>{
 const original=rig({failStart:true});
 await assert.rejects(()=>run(original,'begin'));
 const second=rig();
 await assert.rejects(()=>runReplacement(original,second,'verify'),error=>
   error instanceof FileProofBlocked&&error.code==='TEST_FILE_NOT_RESERVED');
 assert.equal(second.starts(),0);
 assert.equal(second.getSaved(),null);
 await assert.rejects(()=>runApprovedReplacementFileProof({
   config,drive:second.drive,originalJournal:original.journal,
   replacementJournal:original.journal,mode:'complete'
 }),error=>error instanceof FileProofBlocked&&
   error.code==='REPLACEMENT_TEST_CONFIGURATION_REQUIRED');
});

const thirdId='separate_third_file_20261017';
const runThird=(original,second,third,mode,c=config)=>
  runApprovedThirdFileProof({config:c,drive:third.drive,
    originalJournal:original.journal,replacementJournal:second.journal,
    thirdJournal:third.journal,mode});
async function freezeTwo(){
 const original=rig({failStart:true});
 await assert.rejects(()=>run(original,'begin'),/Google may have created/);
 const second=rig({failStart:true,generatedFileId:replacementId});
 await assert.rejects(()=>runReplacement(original,second,'complete'),
   /Google may have created/);
 return {original,second};
}
test('third TEST completes using a third ID without touching either frozen attempt',async()=>{
 const {original,second}=await freezeTwo();
 const beforeFirst=JSON.stringify(original.getSaved());
 const beforeSecond=JSON.stringify(second.getSaved());
 const third=rig({generatedFileId:thirdId});
 assert.deepEqual(await runThird(original,second,third,'prepare'),
   {status:'TEST_FILE_PARENT_VERIFIED',writes:false});
 assert.equal(third.starts(),0);
 assert.equal(third.getSaved(),null);
 const result=await runThird(original,second,third,'complete');
 assert.equal(result.status,'TEST_THIRD_FILE_SHA256_VERIFIED');
 assert.equal(third.starts(),1);
 assert.equal(third.getSaved().file_id,thirdId);
 assert.equal(third.getSaved().state,'VERIFIED');
 assert.equal(third.offset(),third.getSaved().size);
 assert.equal(JSON.stringify(original.getSaved()),beforeFirst);
 assert.equal(JSON.stringify(second.getSaved()),beforeSecond);
 assert.deepEqual((await runThird(original,second,third,'verify')).status,
   'SAME_TEST_FILE_VERIFIED');
 assert.equal((await runThird(original,second,third,'complete')).status,
   'TEST_THIRD_FILE_SHA256_VERIFIED');
 assert.equal(third.starts(),1,'repeat must never produce a fourth provider ID or POST');
 assert.equal(third.events.filter(v=>v==='generate').length,1);
});
test('failed third start is frozen; fourth provider start and both earlier journal writes denied',async()=>{
 const {original,second}=await freezeTwo();
 const beforeFirst=JSON.stringify(original.getSaved());
 const beforeSecond=JSON.stringify(second.getSaved());
 const third=rig({failStart:true,generatedFileId:thirdId});
 await assert.rejects(()=>runThird(original,second,third,'complete'),
   /Google may have created/);
 assert.equal(third.getSaved().state,'START_ATTEMPTED');
 assert.equal(third.getSaved().session_url,null);
 const beforeEvents=third.events.length;
 await assert.rejects(()=>runThird(original,second,third,'complete'),e=>
   e instanceof FileProofBlocked&&e.code==='THIRD_SESSION_UNCERTAIN_NO_RECREATE');
 assert.equal(third.starts(),1);
 assert.equal(third.events.slice(beforeEvents).includes('generate'),false);
 assert.equal(JSON.stringify(original.getSaved()),beforeFirst);
 assert.equal(JSON.stringify(second.getSaved()),beforeSecond);
});
test('third TEST refuses IDs from either prior attempt before reserve or POST',async()=>{
 const {original,second}=await freezeTwo();
 for(const alreadyUsed of [original.getSaved().file_id,second.getSaved().file_id]){
   const third=rig({generatedFileId:alreadyUsed});
   await assert.rejects(()=>runThird(original,second,third,'complete'),e=>
     e instanceof FileProofBlocked&&e.code==='TEST_FILE_ID_UNAVAILABLE');
   assert.equal(third.getSaved(),null);
   assert.equal(third.starts(),0);
 }
});
test('third TEST requires both distinct frozen journals and never guesses missing state',async()=>{
 const {original,second}=await freezeTwo();
 const third=rig({generatedFileId:thirdId});
 second.setSaved(null);
 await assert.rejects(()=>runThird(original,second,third,'prepare'),e=>
   e instanceof FileProofBlocked&&e.code==='PRIOR_TEST_JOURNALS_REQUIRED');
 second.setSaved({...original.getSaved()});
 await assert.rejects(()=>runThird(original,second,third,'complete'),e=>
   e instanceof FileProofBlocked&&e.code==='PRIOR_TEST_IDENTITIES_COLLIDE');
 second.setSaved({...original.getSaved(),file_id:replacementId,
   test_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
 await assert.rejects(()=>runThird(original,second,third,'complete'),e=>
   e instanceof FileProofBlocked&&e.code==='SAVED_TEST_FILE_UNCERTAIN');
 assert.equal(third.getSaved(),null);
 assert.equal(third.events.length,0);
});
test('third TEST rejects unfrozen or changed parent/identity and does not create Google file',async()=>{
 const {original,second}=await freezeTwo();
 const third=rig({generatedFileId:thirdId});
 second.setSaved({...second.getSaved(),state:'SESSION_READY',
   session_url:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=old'});
 await assert.rejects(()=>runThird(original,second,third,'complete'),e=>
   e instanceof FileProofBlocked&&e.code==='PRIOR_TEST_ATTEMPTS_NOT_FROZEN');
 assert.equal(third.starts(),0);
 second.setSaved({...second.getSaved(),state:'START_ATTEMPTED',session_url:null,
   drive_id:'foreign_test_shared_drive'});
 await assert.rejects(()=>runThird(original,second,third,'complete'),e=>
   e instanceof FileProofBlocked&&e.code==='SAVED_TEST_FILE_UNCERTAIN');
 assert.equal(third.starts(),0);
});
test('third TEST verify never creates a missing journal or uses the earlier one',async()=>{
 const {original,second}=await freezeTwo();
 const third=rig({generatedFileId:thirdId});
 await assert.rejects(()=>runThird(original,second,third,'verify'),e=>
   e instanceof FileProofBlocked&&e.code==='TEST_FILE_NOT_RESERVED');
 assert.equal(third.getSaved(),null);
 assert.equal(third.starts(),0);
 await assert.rejects(()=>runApprovedThirdFileProof({config,drive:third.drive,
   originalJournal:original.journal,replacementJournal:second.journal,
   thirdJournal:second.journal,mode:'complete'}),e=>
     e instanceof FileProofBlocked&&e.code==='THIRD_TEST_CONFIGURATION_REQUIRED');
});
