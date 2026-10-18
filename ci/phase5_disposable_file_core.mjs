// FWH Phase 5D source-only disposable Google TEST file proof.
// No Google account, secrets, network or production worker in this module.
// Execution requires an explicitly injected trusted Drive client and durable journal.
import {createHash,randomUUID} from 'node:crypto';

export class FileProofBlocked extends Error {
  constructor(code){super(code);this.name='FileProofBlocked';this.code=code;}
}
const block=code=>{throw new FileProofBlocked(code);};
const ID=/^[A-Za-z0-9_-]{10,160}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const STEP=256*1024;
const SIZE=STEP+37521;
const FORMAT='FWH_DISPOSABLE_FILE_PROOF_V1';

function contentFor(key){
  if(!UUID.test(key))block('TEST_IDENTITY_INVALID');
  const fixture={format:'FWH_DISPOSABLE_FILE_V1',nonce:key,padding:''};
  const overhead=new TextEncoder().encode(JSON.stringify(fixture)).length;
  fixture.padding='F'.repeat(SIZE-overhead);
  return new TextEncoder().encode(JSON.stringify(fixture));
}
const hash=b=>createHash('sha256').update(b).digest('hex');
const spec=r=>({id:r.file_id,parent:r.folder_id,
  name:'FWH_DISPOSABLE_'+r.test_id+'.json',mime:'application/json',
  appProperties:{fwh_package:r.test_id,fwh_manifest:r.sha256}});
function validate(record,config){
  if(!record||record.format!==FORMAT||record.drive_id!==config.driveId
    ||record.folder_id!==config.folderId||!ID.test(record.file_id??'')
    ||record.file_id===record.folder_id||!UUID.test(record.test_id??'')
    ||!SHA.test(record.sha256??'')||record.size!==SIZE
    ||!['RESERVED','START_ATTEMPTED','SESSION_READY','CHUNK_SENT','VERIFIED'].includes(record.state)
    ||(!record.session_url&&!['RESERVED','START_ATTEMPTED'].includes(record.state))
    ||(record.session_url&&typeof record.session_url!=='string')
    ||hash(contentFor(record.test_id))!==record.sha256)block('SAVED_TEST_FILE_UNCERTAIN');
  return contentFor(record.test_id);
}
async function proof(drive,config,record){
  return drive.verifyFile({...spec(record),expectedDriveId:config.driveId,
    sha256:record.sha256,size:record.size});
}

/** All state updates must durably commit before returning.
 * Fail/timeout after START_ATTEMPTED can only reconcile the ORIGINAL ID,
 * never initiate another session or generate a replacement Drive ID.
 */
export async function runDisposableFileProof({
  config,drive,journal,mode,excludedFileId=null,excludedFileIds=null
}={}){
  if(!['prepare','begin','resume','verify','inspect'].includes(mode)
    ||!config||config.testOnly!==true||!ID.test(config.driveId??'')
    ||!ID.test(config.folderId??'')||!ID.test(config.rootId??'')
    ||new Set([config.driveId,config.folderId,config.rootId]).size!==3
    ||typeof config.email!=='string'
    ||(excludedFileId!==null&&!ID.test(excludedFileId))
    ||(excludedFileIds!==null&&(!Array.isArray(excludedFileIds)
      ||excludedFileIds.length>2||excludedFileIds.some(id=>!ID.test(id))
      ||new Set(excludedFileIds).size!==excludedFileIds.length))
    ||!drive||!journal||!['read','reserve','update'].every(k=>typeof journal[k]==='function'))
    block('DISPOSABLE_TEST_CONFIGURATION_REQUIRED');
  const user=await drive.verifyProviderIdentity(config.email);
  if(user.account!==config.email.toLowerCase())block('WORKSPACE_IDENTITY_UNCERTAIN');
  await drive.verifyDestination({folderId:config.rootId,expectedDriveId:config.driveId});
  await drive.verifyDestination({folderId:config.folderId,expectedDriveId:config.driveId});
  if(mode==='prepare')return {status:'TEST_FILE_PARENT_VERIFIED',writes:false};
  let r=await journal.read();
  if(mode==='begin'){
    if(r!==null)block('TEST_FILE_ALREADY_RESERVED');
    const ids=await drive.generateIds(1);
    if(!Array.isArray(ids)||ids.length!==1||!ID.test(ids[0])
      ||ids[0]===config.rootId||ids[0]===config.folderId
      ||ids[0]===excludedFileId
      ||excludedFileIds?.includes(ids[0]))block('TEST_FILE_ID_UNAVAILABLE');
    const testId=randomUUID(),bytes=contentFor(testId);
    r={format:FORMAT,drive_id:config.driveId,folder_id:config.folderId,
      file_id:ids[0],test_id:testId,sha256:hash(bytes),size:bytes.length,
      state:'RESERVED',session_url:null};
    await journal.reserve(r); // persist original ID before provider POST
    await journal.update({...r,state:'START_ATTEMPTED'}); // one-shot attempt
    const start=await drive.startResumable(spec(r),{size:r.size});
    if(start.remote_id!==r.file_id||start.total!==r.size)
      block('TEST_SESSION_UNCERTAIN');
    r={...r,state:'SESSION_READY',session_url:start.session_url};
    await journal.update(r); // save session before sending bytes
    const before=await drive.probeResumable(r.session_url,r.size);
    if(before.complete_candidate||before.offset!==0)block('TEST_OFFSET_UNCERTAIN');
    await drive.uploadChunk(r.session_url,r.size,0,bytes.subarray(0,STEP));
    const after=await drive.probeResumable(r.session_url,r.size);
    if(after.complete_candidate||after.offset!==STEP)block('TEST_OFFSET_UNCERTAIN');
    await journal.update({...r,state:'CHUNK_SENT'});
    return {status:'TEST_FIRST_CHUNK_CONFIRMED',writes:true};
  }
  if(r===null)block('TEST_FILE_NOT_RESERVED');
  const bytes=validate(r,config);
  if(mode==='inspect'){
    // Exact original-ID GET ONLY. A failed GET can NEVER authorize a new
    // resumable session, replacement ID or journal transition.
    if(r.state!=='START_ATTEMPTED'||r.session_url!==null)
      block('ORIGINAL_TEST_ATTEMPT_REQUIRED');
    try{
      await proof(drive,config,r);
      return {status:'ORIGINAL_FILE_EXACT_GET_VERIFIED',writes:false,verified:true};
    }catch(error){
      const accepted=new Set(['PROVIDER_IDENTITY_UNCERTAIN',
        'PROVIDER_AUTH_DENIED','REMOTE_CONTENT_UNVERIFIED',
        'REMOTE_FILE_IDENTITY_MISMATCH','PROVIDER_RETRY_REQUIRED',
        'PROVIDER_OUTCOME_UNCERTAIN','PROVIDER_RESPONSE_UNCERTAIN']);
      const code=accepted.has(error?.code)?error.code:'PROVIDER_CHECK_UNAVAILABLE';
      return {status:'ORIGINAL_FILE_NOT_VERIFIED',reason:code,
        writes:false,verified:false};
    }
  }
  if(r.state==='RESERVED')block('TEST_FILE_RESERVED_NO_CREATE');
  if(r.state==='START_ATTEMPTED'){
    // Lost session initiation is ambiguous. The only permitted recovery is
    // an independent GET of the original immutable ID, NEVER another POST.
    // A 404/403 is uncertainty, not proof that recreating it is safe.
    if(mode!=='verify')block('TEST_SESSION_UNCERTAIN_NO_RECREATE');
    await proof(drive,config,r);
    await journal.update({...r,state:'VERIFIED'});
    return {status:'SAME_TEST_FILE_VERIFIED',writes:false};
  }
  if(mode==='verify'||r.state==='VERIFIED'){
    await proof(drive,config,r);
    if(r.state!=='VERIFIED')await journal.update({...r,state:'VERIFIED'});
    return {status:'SAME_TEST_FILE_VERIFIED',writes:false};
  }
  const before=await drive.probeResumable(r.session_url,r.size);
  if(!before.complete_candidate){
    const offset=before.offset;
    if(!Number.isSafeInteger(offset)||offset<0||offset>=r.size)
      block('TEST_OFFSET_UNCERTAIN');
    const n=Math.min(STEP,r.size-offset);
    await drive.uploadChunk(r.session_url,r.size,offset,bytes.subarray(offset,offset+n));
    const after=await drive.probeResumable(r.session_url,r.size);
    if(!after.complete_candidate)block('TEST_FILE_NOT_YET_COMPLETE');
  }
  await proof(drive,config,r);
  await journal.update({...r,state:'VERIFIED'});
  return {status:'TEST_FILE_SHA256_VERIFIED',writes:true};
}

// One separately approved disposable TEST attempt. The original ID and journal
// are never rewritten/retried: this accepts only the known lost-session state.
// A replacement has its OWN exclusive journal and one-shot generated Google ID.
export async function runApprovedReplacementFileProof({
  config,drive,originalJournal,replacementJournal,mode
}={}){
  if(!['prepare','complete','verify'].includes(mode)
    ||typeof originalJournal?.read!=='function'
    ||!replacementJournal
    ||originalJournal===replacementJournal)
    block('REPLACEMENT_TEST_CONFIGURATION_REQUIRED');
  const original=await originalJournal.read();
  if(!config||!original)block('ORIGINAL_TEST_JOURNAL_REQUIRED');
  validate(original,config); // exact original TEST drive/folder/bytes binding
  if(original.state!=='START_ATTEMPTED'||original.session_url!==null)
    block('ORIGINAL_TEST_ATTEMPT_REQUIRED');
  const guarded={config,drive,journal:replacementJournal,excludedFileId:original.file_id};
  if(mode==='prepare')
    return runDisposableFileProof({...guarded,mode:'prepare'});
  const saved=await replacementJournal.read();
  if(saved!==null){
    validate(saved,config);
    if(saved.file_id===original.file_id)block('REPLACEMENT_FILE_ID_COLLISION');
  }
  if(mode==='verify')
    return runDisposableFileProof({...guarded,mode:'verify'});
  if(saved?.state==='RESERVED'||saved?.state==='START_ATTEMPTED')
    block('REPLACEMENT_SESSION_UNCERTAIN_NO_RECREATE');
  if(saved===null)
    await runDisposableFileProof({...guarded,mode:'begin'});
  // Resume ONLY the original session persisted in this replacement journal.
  // On lost POST/session response, later invocations stop (no third ID).
  const result=await runDisposableFileProof({...guarded,mode:'resume'});
  if(!['TEST_FILE_SHA256_VERIFIED','SAME_TEST_FILE_VERIFIED'].includes(result.status))
    block('REPLACEMENT_FINAL_RECEIPT_UNVERIFIED');
  return {...result,status:'TEST_REPLACEMENT_FILE_SHA256_VERIFIED'};
}


// The operator separately approved exactly one THIRD disposable TEST file after
// two independent Google session-start results were frozen without a usable URL.
// Both earlier journals remain read-only, immutable evidence. A third attempt
// has its own file ID and owner-private journal; it cannot authorize a fourth.
export async function runApprovedThirdFileProof({
  config,drive,originalJournal,replacementJournal,thirdJournal,mode
}={}){
  if(!['prepare','complete','verify'].includes(mode)
    ||!config||typeof originalJournal?.read!=='function'
    ||typeof replacementJournal?.read!=='function'
    ||!thirdJournal||typeof thirdJournal.read!=='function'
    ||typeof thirdJournal.reserve!=='function'
    ||typeof thirdJournal.update!=='function'
    ||originalJournal===replacementJournal
    ||originalJournal===thirdJournal
    ||replacementJournal===thirdJournal)
    block('THIRD_TEST_CONFIGURATION_REQUIRED');
  const first=await originalJournal.read();
  const second=await replacementJournal.read();
  if(!first||!second)block('PRIOR_TEST_JOURNALS_REQUIRED');
  validate(first,config);
  validate(second,config);
  if(first.state!=='START_ATTEMPTED'||first.session_url!==null
    ||second.state!=='START_ATTEMPTED'||second.session_url!==null)
    block('PRIOR_TEST_ATTEMPTS_NOT_FROZEN');
  if(first.file_id===second.file_id||first.test_id===second.test_id)
    block('PRIOR_TEST_IDENTITIES_COLLIDE');
  const guarded={config,drive,journal:thirdJournal,
    excludedFileIds:[first.file_id,second.file_id]};
  if(mode==='prepare')
    return runDisposableFileProof({...guarded,mode:'prepare'});
  const saved=await thirdJournal.read();
  if(saved!==null){
    validate(saved,config);
    if(guarded.excludedFileIds.includes(saved.file_id)
      ||saved.test_id===first.test_id||saved.test_id===second.test_id)
      block('THIRD_TEST_IDENTITY_COLLISION');
  }
  if(mode==='verify')
    return runDisposableFileProof({...guarded,mode:'verify'});
  if(saved?.state==='RESERVED'||saved?.state==='START_ATTEMPTED')
    block('THIRD_SESSION_UNCERTAIN_NO_RECREATE');
  if(saved===null)
    await runDisposableFileProof({...guarded,mode:'begin'});
  // Only the durable saved session may continue. A lost start URL remains
  // frozen, and a final receipt is an independent original-ID Google GET.
  const result=await runDisposableFileProof({...guarded,mode:'resume'});
  if(!['TEST_FILE_SHA256_VERIFIED','SAME_TEST_FILE_VERIFIED'].includes(result.status))
    block('THIRD_FINAL_RECEIPT_UNVERIFIED');
  return {...result,status:'TEST_THIRD_FILE_SHA256_VERIFIED'};
}
