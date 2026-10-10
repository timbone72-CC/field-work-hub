// One protected, fenced resumable JPEG/manifest chunk per invocation.
// Works exclusively with an already-reserved immutable Google Drive ID.
// No phone/contractor credential, automatic cleanup or new upload queue.
import {DriveUncertain} from './drive-client.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const STEP=256*1024;

export async function transferOnePreparedChunk({
  plan,workerId,generation,drive,ledger,vault,readProtectedChunk
}={}){
  if(!plan||!UUID.test(plan.package_id??'')||!UUID.test(workerId??'')
   ||!UUID.test(plan.plan_id??'')||!Number.isSafeInteger(generation)||generation<1
   ||!['PHOTO','MANIFEST'].includes(plan.kind)||!SHA.test(plan.sha256??'')
   ||!Number.isSafeInteger(plan.size)||plan.size<=0||plan.size>33554432
   ||typeof plan.file_id!=='string'||typeof plan.parent_id!=='string'
   ||!plan.appProperties||typeof readProtectedChunk!=='function'
   ||!ledger||!drive||!vault)throw new DriveUncertain('EXACT_PREALLOCATED_FILE_REQUIRED');
  const ctx={packageId:plan.package_id,fileId:plan.file_id};
  const auth=()=>ledger.heartbeat(plan.package_id,workerId,generation);
  // A bound, encrypted session is read from the server's private journal.
  await auth();
  const entry=await ledger.getSession(plan.plan_id);
  let session;
  if(entry){
    if(entry.package_id!==plan.package_id||entry.plan_id!==plan.plan_id
       ||entry.total_bytes!==plan.size)throw new DriveUncertain('JOURNAL_IDENTITY_MISMATCH');
    try{session=await vault.open(entry.encrypted,ctx);}
    catch{throw new DriveUncertain('JOURNAL_DECRYPTION_FAILED');}
  }else{
    await auth();
    const started=await drive.startResumable({id:plan.file_id,parent:plan.parent_id,
      name:plan.name,mime:plan.mime,appProperties:plan.appProperties},{size:plan.size});
    if(started.remote_id!==plan.file_id||started.total!==plan.size)
      throw new DriveUncertain('REMOTE_SESSION_IDENTITY_MISMATCH');
    const encrypted=await vault.seal(started.session_url,ctx);
    // Persist ciphertext before using session capability for a single byte.
    await ledger.storeSession(plan.package_id,workerId,generation,plan.plan_id,encrypted);
    session=started.session_url;
  }
  await auth();
  const probe=await drive.probeResumable(session,plan.size);
  if(probe.complete_candidate){
    await ledger.recordOffset(plan.package_id,workerId,generation,plan.plan_id,plan.size,true);
    await auth();
    const verified=await drive.verifyFile({id:plan.file_id,parent:plan.parent_id,
      mime:plan.mime,sha256:plan.sha256,size:plan.size,appProperties:plan.appProperties});
    await ledger.confirmFile(plan,workerId,generation,verified);
    return {state:'FILE_VERIFIED',plan_id:plan.plan_id,remote_id:plan.file_id};
  }
  const offset=probe.offset;
  if(!Number.isSafeInteger(offset)||offset<0||offset>=plan.size)
    throw new DriveUncertain('PROVIDER_OFFSET_UNCERTAIN');
  await ledger.recordOffset(plan.package_id,workerId,generation,plan.plan_id,offset,false);
  const size=Math.min(STEP,plan.size-offset);
  // The protected reader is owned by the server and must use the exact receipt
  // identity, never a client-provided bucket URL or mutable WO label.
  await auth();
  const chunk=await readProtectedChunk(plan,offset,size);
  if(!(chunk instanceof Uint8Array)||chunk.length!==size)
    throw new DriveUncertain('PROTECTED_SOURCE_CHUNK_UNAVAILABLE');
  await auth();
  const uploaded=await drive.uploadChunk(session,plan.size,offset,chunk);
  if(uploaded.complete_candidate){
    await ledger.recordOffset(plan.package_id,workerId,generation,plan.plan_id,plan.size,true);
    await auth();
    const verified=await drive.verifyFile({id:plan.file_id,parent:plan.parent_id,
      mime:plan.mime,sha256:plan.sha256,size:plan.size,appProperties:plan.appProperties});
    await ledger.confirmFile(plan,workerId,generation,verified);
    return {state:'FILE_VERIFIED',plan_id:plan.plan_id,remote_id:plan.file_id};
  }
  // A PUT 308 isn't accepted progress until a separate provider status probe.
  await auth();
  const actual=await drive.probeResumable(session,plan.size);
  if(actual.complete_candidate){
    await ledger.recordOffset(plan.package_id,workerId,generation,plan.plan_id,plan.size,true);
    return {state:'NEEDS_INDEPENDENT_GET',plan_id:plan.plan_id};
  }
  if(!Number.isSafeInteger(actual.offset)||actual.offset<offset+size)
    throw new DriveUncertain('PROVIDER_PROGRESS_UNCERTAIN');
  await ledger.recordOffset(plan.package_id,workerId,generation,plan.plan_id,actual.offset,false);
  return {state:'PROGRESS',plan_id:plan.plan_id,recorded_offset:actual.offset,total:plan.size};
}
