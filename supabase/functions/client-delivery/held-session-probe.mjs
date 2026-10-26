// Original Phase 5D TEST ONLY: non-content Google resumable status query.
// Requires an ALREADY held global dispatch permit bound to the exact failed
// saved-session continuation, enforced by the service-role-only SQL RPC.
// No protected media, Google upload-start/PUT bytes, SQL mutation or release.
import {createDriveClient,DriveUncertain} from './drive-client.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID=/^[A-Za-z0-9_-]{10,160}$/;
const MAX=32*1024*1024;
const RESULTS=new Set([
 'HELD_TEST_SESSION_INCOMPLETE','HELD_TEST_SESSION_COMPLETE_CANDIDATE',
 'HELD_TEST_SESSION_UNAVAILABLE_404','HELD_TEST_SESSION_AUTH_DENIED',
 'HELD_TEST_SESSION_PROVIDER_OTHER','HELD_TEST_SESSION_TRANSPORT_UNCERTAIN'
]);

export async function inspectOriginalHeldFirstPhotoSession({
 ledger,tokenProvider,vault,fetcher=fetch,
 testPackageId,testDestinationId,testRootId,expectedDriveId,expectedEmail
}={}){
 if(typeof ledger?.readHeldTestFirstPhoto!=='function'
  ||typeof tokenProvider!=='function'||typeof vault?.open!=='function'
  ||typeof fetcher!=='function'
  ||!UUID.test(testPackageId??'')||!UUID.test(testDestinationId??'')
  ||!ID.test(testRootId??'')||!ID.test(expectedDriveId??'')
  ||typeof expectedEmail!=='string'||!expectedEmail)
  throw new DriveUncertain('HELD_TEST_PROBE_NOT_CONFIGURED');
 // Service-side SQL does the immutable-original, exact permit, expired-lease,
 // same worker, session revision and saved-offset checks. It supplies ONLY the
 // original AES-GCM ciphertext under the existing service-role credential.
 const s=await ledger.readHeldTestFirstPhoto(
  testPackageId,testDestinationId,testRootId);
 if(s?.status!=='ORIGINAL_TEST_HELD_FIRST_PHOTO_EXACT'
  ||s.package_id!==testPackageId
  ||s.destination_id!==testDestinationId||s.root_id!==testRootId
  ||!UUID.test(s.worker_id??'')||s.generation!==1
  ||!UUID.test(s.photo_plan_id??'')||!ID.test(s.photo_remote_id??'')
  ||!ID.test(s.parent_remote_id??'')||s.drive_id!==expectedDriveId
  ||!Number.isSafeInteger(s.expected_size)||s.expected_size<1
  ||s.expected_size>MAX
  ||!Number.isSafeInteger(s.saved_offset)||s.saved_offset<1
  ||s.saved_offset>=s.expected_size
  ||!Number.isSafeInteger(s.session_revision)||s.session_revision<3
  ||!s.sealed_session||s.sealed_session.version!==1)
  throw new DriveUncertain('HELD_TEST_PROBE_IDENTITY_MISMATCH');
 // This decryption happens in the trusted worker. Never return/log the URL.
 let url;
 try{url=await vault.open(s.sealed_session,{
   packageId:testPackageId,fileId:s.photo_remote_id
 });}
 catch{throw new DriveUncertain('HELD_TEST_PROBE_SESSION_DECRYPTION_FAILED');}
 // vault.open validates https://www.googleapis.com and URL bytes.
 // Defense in depth against an injected mock or accidental loose vault.
 let target;
 try{target=new URL(url);}
 catch{throw new DriveUncertain('HELD_TEST_PROBE_BAD_SESSION');}
 if(target.origin!=='https://www.googleapis.com'
  ||target.protocol!=='https:'||target.username||target.password
  ||target.hash||url.length>7000)
  throw new DriveUncertain('HELD_TEST_PROBE_BAD_SESSION');
 let token;
 try{token=await tokenProvider();}
 catch{throw new DriveUncertain('HELD_TEST_PROBE_OAUTH_UNAVAILABLE');}
 if(typeof token?.accessToken!=='string'||token.accessToken.length<20
  ||!Number.isInteger(token.expiresInSeconds)||token.expiresInSeconds<60)
  throw new DriveUncertain('HELD_TEST_PROBE_OAUTH_UNAVAILABLE');
 const drive=createDriveClient({accessToken:token.accessToken,fetcher});
 // Verify the previously approved Workspace account before using the opaque URL.
 const who=await drive.verifyProviderIdentity(expectedEmail);
 if(who?.account!==expectedEmail.toLowerCase())
  throw new DriveUncertain('HELD_TEST_PROBE_ACCOUNT_MISMATCH');
 let response;
 try{
  // Official Drive status query is a zero-content PUT. This has no photo
  // body, no session initiation and no ability to select a new file ID.
  response=await fetcher(url,{
   method:'PUT',redirect:'manual',signal:AbortSignal.timeout(20000),
   headers:{
    Authorization:'Bearer '+token.accessToken,
    'Content-Length':'0',
    'Content-Range':'bytes */'+s.expected_size
   }
  });
 }catch{
  return Object.freeze({
   status:'HELD_TEST_SESSION_TRANSPORT_UNCERTAIN',http_status:null,
   saved_offset:s.saved_offset,provider_offset:null
  });
 }
 try{
  const code=response?.status;
  // A 308 without Location is Drive progress, NOT an HTTP redirect.
  // Never follow or accept a redirect to a different upload capability.
  if(code>=300&&code<400&&response?.headers?.has('Location'))
    throw new DriveUncertain('HELD_TEST_PROBE_REDIRECT_FORBIDDEN');
  let status,providerOffset=null;
  if(code===308){
   const range=response.headers?.get('Range');
   if(range===null){status='HELD_TEST_SESSION_INCOMPLETE';providerOffset=0;}
   else{
    const m=/^bytes=0-([0-9]+)$/.exec(range??'');
    const n=m?Number(m[1])+1:null;
    if(!Number.isSafeInteger(n)||n<0||n>=s.expected_size)
      throw new DriveUncertain('HELD_TEST_PROBE_INVALID_RANGE');
    providerOffset=n;
    status='HELD_TEST_SESSION_INCOMPLETE';
   }
  }else if(code===200||code===201){
   status='HELD_TEST_SESSION_COMPLETE_CANDIDATE';
  }else if(code===404){
   status='HELD_TEST_SESSION_UNAVAILABLE_404';
  }else if(code===401||code===403){
   status='HELD_TEST_SESSION_AUTH_DENIED';
  }else if(Number.isInteger(code)&&code>=300&&code<=599){
   status='HELD_TEST_SESSION_PROVIDER_OTHER';
  }else{
   throw new DriveUncertain('HELD_TEST_PROBE_INVALID_RESPONSE');
  }
  if(!RESULTS.has(status))throw new DriveUncertain('HELD_TEST_PROBE_INVALID_RESPONSE');
  // 200/201 is not a content receipt; 308 is not authorization to PUT.
  // Keep exact offsets and the held global dispatch/journal unchanged.
  return Object.freeze({
   status,http_status:code,saved_offset:s.saved_offset,
   provider_offset:providerOffset
  });
 }finally{
  await response?.body?.cancel?.().catch(()=>{});
 }
}


// Exact original preallocated Drive-ID inspection AFTER a separate one-shot
// session diagnostic reported 404. The prior upload session MUST NOT be reused.
// This reads metadata for the SAME immutable ID; it neither proves full content
// delivery nor authorizes a replacement session, another file ID, or SQL writes.
export async function inspectOriginalHeldFirstPhotoFile({
 ledger,tokenProvider,fetcher=fetch,testPackageId,testDestinationId,
 testRootId,expectedDriveId,expectedEmail
}={}){
 if(typeof ledger?.readHeldTestFirstPhoto!=='function'
  ||typeof tokenProvider!=='function'||typeof fetcher!=='function'
  ||!UUID.test(testPackageId??'')||!UUID.test(testDestinationId??'')
  ||!ID.test(testRootId??'')||!ID.test(expectedDriveId??'')
  ||typeof expectedEmail!=='string'||!expectedEmail)
  throw new DriveUncertain('HELD_FILE_PROBE_NOT_CONFIGURED');
 // This existing, service-only SQL read requires the SAME global dispatch
 // permit, original continuation journal, expired lease, file plan and
 // encrypted saved-session revision. No caller chooses a remote ID.
 const s=await ledger.readHeldTestFirstPhoto(testPackageId,testDestinationId,testRootId);
 if(s?.status!=='ORIGINAL_TEST_HELD_FIRST_PHOTO_EXACT'
  ||s.package_id!==testPackageId||s.destination_id!==testDestinationId
  ||s.root_id!==testRootId||!UUID.test(s.worker_id??'')
  ||s.generation!==1||!UUID.test(s.photo_plan_id??'')
  ||!ID.test(s.photo_remote_id??'')||!ID.test(s.parent_remote_id??'')
  ||s.drive_id!==expectedDriveId
  ||!Number.isSafeInteger(s.expected_size)||s.expected_size<1||s.expected_size>MAX
  ||!Number.isSafeInteger(s.saved_offset)||s.saved_offset<1
  ||s.saved_offset>=s.expected_size
  ||!Number.isSafeInteger(s.session_revision)||s.session_revision<3
  ||s.sealed_session?.version!==1)
  throw new DriveUncertain('HELD_FILE_PROBE_IDENTITY_MISMATCH');
 let token;
 try{token=await tokenProvider();}
 catch{throw new DriveUncertain('HELD_FILE_PROBE_OAUTH_UNAVAILABLE');}
 if(typeof token?.accessToken!=='string'||token.accessToken.length<20
  ||!Number.isInteger(token.expiresInSeconds)||token.expiresInSeconds<60)
  throw new DriveUncertain('HELD_FILE_PROBE_OAUTH_UNAVAILABLE');
 const drive=createDriveClient({accessToken:token.accessToken,fetcher});
 const who=await drive.verifyProviderIdentity(expectedEmail);
 if(who?.account!==expectedEmail.toLowerCase())
  throw new DriveUncertain('HELD_FILE_PROBE_ACCOUNT_MISMATCH');
 // Existing Drive adapter performs an authenticated, redirects-denied,
 // metadata-only files.get on the EXACT original ID, with supportsAllDrives.
 // The adapter's historical "FolderId" name does not impose a folder MIME.
 let observation;
 try{observation=await drive.inspectOriginalFolderId(s.photo_remote_id);}
 catch(e){
  if(e instanceof DriveUncertain&&e.code==='PROVIDER_AUTH_DENIED')
   return Object.freeze({status:'HELD_TEST_FILE_AUTH_DENIED',http_status:null});
  return Object.freeze({status:'HELD_TEST_FILE_PROVIDER_UNCERTAIN',http_status:null});
 }
 if(observation?.state==='NOT_FOUND')
  return Object.freeze({status:'HELD_TEST_FILE_NOT_FOUND_404',http_status:404});
 if(observation?.state!=='PRESENT')
  throw new DriveUncertain('HELD_FILE_PROBE_INVALID_RESPONSE');
 const m=observation.metadata;
 const props=m?.appProperties;
 const exact= m?.id===s.photo_remote_id && m.trashed===false
  && m.mimeType==='image/jpeg' && m.driveId===expectedDriveId
  && Array.isArray(m.parents)&&m.parents.length===1
  && m.parents[0]===s.parent_remote_id
  && typeof m.name==='string'
  && m.name.length>0 && m.name.length<=160
  && props&&typeof props==='object'&&!Array.isArray(props)
  && Object.keys(props).sort().join(',')==='fwh_manifest,fwh_package'
  && props.fwh_package===testPackageId
  && /^[a-f0-9]{64}$/.test(props.fwh_manifest??'');
 return Object.freeze({status:exact?
  'HELD_TEST_FILE_PRESENT_CANDIDATE':'HELD_TEST_FILE_IDENTITY_MISMATCH',
  http_status:200});
}
