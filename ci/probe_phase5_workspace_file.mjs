// Explicit laptop-only disposable Drive file proof for approved Phase 5D.
// Not a browser endpoint, scheduler, client-delivery worker or photo uploader.
// It reuses the existing protected Workspace TEST receipt and folder attempt.
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {open,lstat,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runDisposableFileProof,runApprovedReplacementFileProof,
  runApprovedThirdFileProof,runStagedFourthFileProof} from './phase5_disposable_file_core.mjs';
import {createWorkspaceTokenProvider} from '../supabase/functions/client-delivery/workspace-oauth.mjs';
import {createDriveClient} from '../supabase/functions/client-delivery/drive-client.mjs';
import {preferIPv4ForLocalWorkspaceBootstrap} from './authorize_phase5_workspace_provider.mjs';

const home=join(homedir(),'.config','field-work-hub');
const credentialPath=join(home,'workspace-oauth-test.json');
const folderPath=join(home,'phase5-disposable-folder-proof.json');
const receiptPath=join(home,'phase5-disposable-file-proof.json');
// Separate one-time operator-approved TEST attempt; NEVER overwrite the original.
const replacementPath=join(home,'phase5-disposable-file-proof-replacement-20261017.json');
// Exactly one separately approved third TEST file; previous journals untouched.
const thirdPath=join(home,'phase5-disposable-file-proof-third-20261017.json');
// Fourth is staged in source only; no provider POST without explicit operator approval.
const fourthPath=join(home,'phase5-disposable-file-proof-fourth-20261017.json');
const lockPath=join(home,'phase5-disposable-file-proof.lock');
const testMarker='DISPOSABLE_FWH_TEST_ONLY';
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const SAFE_CODES=new Set([
  'ORIGINAL_TEST_JOURNAL_REQUIRED','ORIGINAL_TEST_ATTEMPT_REQUIRED',
  'SAVED_TEST_FILE_UNCERTAIN','REPLACEMENT_TEST_CONFIGURATION_REQUIRED',
  'REPLACEMENT_FILE_ID_COLLISION','REPLACEMENT_SESSION_UNCERTAIN_NO_RECREATE',
  'REPLACEMENT_FINAL_RECEIPT_UNVERIFIED','DISPOSABLE_TEST_CONFIGURATION_REQUIRED',
  'EXACT_EXISTING_TEST_FOLDER_REQUIRED','TEST_FILE_ALREADY_RESERVED',
  'TEST_FILE_NOT_RESERVED','TEST_FILE_RESERVED_NO_CREATE',
  'TEST_FILE_ID_UNAVAILABLE','TEST_SESSION_UNCERTAIN','TEST_OFFSET_UNCERTAIN',
  'TEST_SESSION_UNCERTAIN_NO_RECREATE','TEST_FILE_NOT_YET_COMPLETE',
  'WORKSPACE_IDENTITY_UNCERTAIN','PROVIDER_AUTH_DENIED',
  'PROVIDER_IDENTITY_UNCERTAIN','PROVIDER_RETRY_REQUIRED',
  'PROVIDER_OUTCOME_UNCERTAIN','PROVIDER_RESPONSE_UNCERTAIN',
  'PROVIDER_REDIRECT_FORBIDDEN',
  'UPLOAD_SESSION_UNCERTAIN','RESUMABLE_OFFSET_UNCERTAIN',
  'REMOTE_FILE_IDENTITY_MISMATCH','REMOTE_CONTENT_UNVERIFIED',
  'UNTRUSTED_UPLOAD_SESSION','UPLOAD_SESSION_MALFORMED',
  'UPLOAD_SESSION_ENDPOINT_UNRECOGNIZED','UPLOAD_SESSION_QUERY_UNRECOGNIZED',
  'PROTECTED_LOCAL_FILE_REQUIRED',
  'PROTECTED_LOCAL_DIRECTORY_REQUIRED','INVALID_UPLOAD_SIZE',
  'EXACT_APP_PROPERTIES_REQUIRED','PREALLOCATED_ID_REQUIRED',
  'THIRD_TEST_CONFIGURATION_REQUIRED','PRIOR_TEST_JOURNALS_REQUIRED',
  'PRIOR_TEST_ATTEMPTS_NOT_FROZEN','PRIOR_TEST_IDENTITIES_COLLIDE',
  'THIRD_TEST_IDENTITY_COLLISION','THIRD_SESSION_UNCERTAIN_NO_RECREATE',
  'THIRD_FINAL_RECEIPT_UNVERIFIED',
  'FOURTH_TEST_CONFIGURATION_REQUIRED','THREE_PRIOR_TEST_JOURNALS_REQUIRED',
  'THREE_PRIOR_TEST_ATTEMPTS_NOT_FROZEN','THREE_PRIOR_TEST_IDENTITIES_COLLIDE',
  'FOURTH_TEST_IDENTITY_COLLISION','FOURTH_SESSION_UNCERTAIN_NO_RECREATE',
  'FOURTH_FINAL_RECEIPT_UNVERIFIED','FOURTH_TEST_ALREADY_RESERVED'
]);
const safeFailure=error=>SAFE_CODES.has(error?.code)?error.code
  :error?.code==='EEXIST'?'PROTECTED_TEST_LOCK_OR_JOURNAL_EXISTS'
  :error?.code==='ENOENT'?'REQUIRED_TEST_FILE_MISSING'
  :'TEST_FILE_GATE_UNVERIFIED';
async function readProtected(path,optional=false){
 let st;
 try{st=await lstat(path);}
 catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
 if(!st.isFile()||(st.mode&0o077)!==0||st.size>16384
   ||(process.getuid&&st.uid!==process.getuid()))
   fail('PROTECTED_LOCAL_FILE_REQUIRED');
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{return JSON.parse(await f.readFile('utf8'));}
 finally{await f.close();}
}
async function syncHome(){
 const d=await open(home,constants.O_DIRECTORY|constants.O_RDONLY);
 try{await d.sync();}finally{await d.close();}
}
async function putOriginal(value,path=receiptPath){
 const fd=await open(path,'wx',0o600);
 try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}
 finally{await fd.close();}
 await syncHome();
}
async function replaceOriginal(value,path=receiptPath){
 const temporary=path+'.'+randomUUID()+'.tmp';
 const fd=await open(temporary,'wx',0o600);
 try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}
 finally{await fd.close();}
 await rename(temporary,path);
 await syncHome();
}
async function execute(mode,attempt='original'){
 const dir=await lstat(home);
 if(!dir.isDirectory()||(dir.mode&0o077)!==0
   ||(process.getuid&&dir.uid!==process.getuid()))
   fail('PROTECTED_LOCAL_DIRECTORY_REQUIRED');
 const credential=await readProtected(credentialPath);
 const folderRecord=await readProtected(folderPath);
 const folder=folderRecord?.spec;
 const config={
   testOnly:credential?.FWH_TEST_EVIDENCE_CLASS===testMarker
     &&folderRecord?.format==='FWH_TEST_FOLDER_V1'
     &&credential.FWH_TEST_CLIENT_SHARED_DRIVE_ID===folderRecord.drive
     &&credential.FWH_TEST_CLIENT_ROOT_FOLDER_ID===folderRecord.root
     &&folder?.parent===folderRecord.root
     &&folder?.mime==='application/vnd.google-apps.folder'
     &&folder?.appProperties?.fwh_kind==='ADDRESS',
   email:credential.FWH_TEST_WORKSPACE_EMAIL,
   driveId:credential.FWH_TEST_CLIENT_SHARED_DRIVE_ID,
   rootId:credential.FWH_TEST_CLIENT_ROOT_FOLDER_ID,
   folderId:folder?.id
 };
 if(!config.testOnly)fail('EXACT_EXISTING_TEST_FOLDER_REQUIRED');
 const refresh=createWorkspaceTokenProvider({
  clientId:credential.FWH_TEST_WORKSPACE_CLIENT_ID,
  clientSecret:credential.FWH_TEST_WORKSPACE_CLIENT_SECRET,
  refreshToken:credential.FWH_TEST_WORKSPACE_REFRESH_TOKEN,
  requiredScope:credential.FWH_TEST_WORKSPACE_SCOPE
 });
 const journalFor=path=>({read:()=>readProtected(path,true),
   reserve:value=>putOriginal(value,path),
   update:value=>replaceOriginal(value,path)});
 const journal=journalFor(receiptPath);
 const replacementJournal=journalFor(replacementPath);
 const thirdJournal=journalFor(thirdPath);
 const fourthJournal=journalFor(fourthPath);
 // Never expose credential contents, session URL, Google IDs or origin errors.
 const lock=await open(lockPath,'wx',0o600);
 try{
   const auth=await refresh();
   const drive=createDriveClient({accessToken:auth.accessToken});
   // Reconcile exact saved folder identity, not an arbitrary writable folder.
   await drive.verifyFile({id:folder.id,parent:folder.parent,
     name:folder.name,mime:folder.mime,sha256:null,size:null,
     appProperties:folder.appProperties,expectedDriveId:config.driveId});
   if(attempt==='all'){
     // One bounded read-only exact-ID GET per existing disposable attempt.
     // Auth refresh may POST to Google OAuth; there are no Drive file writes,
     // new generated IDs, journal updates, session starts or byte PUTs here.
     for(const [label,path] of [
       ['ORIGINAL',receiptPath],['SECOND',replacementPath],['THIRD',thirdPath]
     ]){
       const record={read:()=>readProtected(path),
         reserve:()=>fail('READ_ONLY_TEST_JOURNAL'),
         update:()=>fail('READ_ONLY_TEST_JOURNAL')};
       const result=await runDisposableFileProof({config,drive,
         journal:record,mode:'inspect'});
       const resultLine=result.verified===false
         ?'BLOCKED: '+label+'_'+result.status+' ('+result.reason+')'
         :'PASS: '+label+'_'+result.status;
       process.stdout.write(resultLine+'. No Drive file write.\n');
       if(result.verified===false)process.exitCode=1;
     }
     return;
   }
   const result=attempt==='fourth'
     ?await runStagedFourthFileProof({config,drive,
       originalJournal:{read:()=>readProtected(receiptPath)},
       replacementJournal:{read:()=>readProtected(replacementPath)},
       thirdJournal:{read:()=>readProtected(thirdPath)},
       fourthJournal,mode})
     :attempt==='third'
     ?await runApprovedThirdFileProof({config,drive,
       originalJournal:{read:()=>readProtected(receiptPath)},
       replacementJournal:{read:()=>readProtected(replacementPath)},
       thirdJournal,mode})
     :attempt==='replacement'
       ?await runApprovedReplacementFileProof({config,drive,
         originalJournal:{read:()=>readProtected(receiptPath)},
         replacementJournal,mode})
       :await runDisposableFileProof({config,drive,journal,mode});
   if(result.verified===false){
     // A missing/inaccessible object is NOT proof that a second create is safe.
     process.stdout.write('BLOCKED: '+result.status+' ('+result.reason+
       '). Original file ID retained; no Drive file write.\n');
     process.exitCode=1;
   }else{
     process.stdout.write('PASS: '+result.status+
       '. TEST only; no customer photos or Send.\n');
   }
 }finally{
   // A retained lock after process crash intentionally requires operator
   // reconciliation; never auto-replay an ambiguous Google create.
   await lock.close();
   // The normal path can release the lock; a crash leaves it for inspection.
   const {unlink}=await import('node:fs/promises');
   await unlink(lockPath);
   await syncHome();
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 preferIPv4ForLocalWorkspaceBootstrap();
 const modes={'--prepare':['prepare','original'],
   '--begin':['begin','original'],'--resume':['resume','original'],
   '--verify':['verify','original'],'--inspect':['inspect','original'],
   '--replacement-prepare':['prepare','replacement'],
   '--replacement-complete':['complete','replacement'],
   '--replacement-verify':['verify','replacement'],
   '--third-prepare':['prepare','third'],
   '--third-complete':['complete','third'],
   '--third-verify':['verify','third'],
   '--fourth-prepare':['prepare','fourth'],
   '--fourth-complete':['complete','fourth'],
   '--fourth-verify':['verify','fourth'],
   '--inspect-all':['inspect','all']};
 const selected=modes[process.argv[2]];
 if(process.argv.length!==3||!selected){
   process.stderr.write('BLOCKED: VALID_TEST_MODE_REQUIRED\n');
   process.exitCode=1;
 }else{
   execute(selected[0],selected[1]).catch(error=>{
     // Only checked status constants may appear, NEVER Google response bodies,
     // local JSON, OAuth values, original IDs or resumable session URLs.
     process.stderr.write('BLOCKED: '+safeFailure(error)+
       '. All TEST journals must be preserved; no blind retry.\n');
     process.exitCode=1;
   });
 }
}
