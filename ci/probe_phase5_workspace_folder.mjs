// One TEST-only, operator-controlled Google Drive folder proof.
// This does not configure clients, grant permissions, enable Send, or deliver photos.
// An original reserved ID is journaled before the ONE possible create POST.
// Any subsequent invocation may only GET/list that ID. Never blind-recreate.
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createWorkspaceTokenProvider} from '../supabase/functions/client-delivery/workspace-oauth.mjs';
import {createDriveClient} from '../supabase/functions/client-delivery/drive-client.mjs';
import {preferIPv4ForLocalWorkspaceBootstrap} from './authorize_phase5_workspace_provider.mjs';

const ID=/^[A-Za-z0-9_-]{10,160}$/;
const MAIL=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const SCOPE='https://www.googleapis.com/auth/drive';
const HOME=join(homedir(),'.config','field-work-hub');
const JOURNAL=join(HOME,'phase5-disposable-folder-proof.json');
const MARK='DISPOSABLE_FWH_TEST_ONLY';
export class FolderProbeBlocked extends Error {
  constructor(code){super(code);this.code=code;this.name='FolderProbeBlocked';}
}
const deny=code=>{throw new FolderProbeBlocked(code);};
const ownKeys=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)
  &&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
export function validateProofConfiguration(env){
  if(env?.FWH_TEST_EVIDENCE_CLASS!==MARK)deny('TEST_ONLY_EVIDENCE_REQUIRED');
  const email=env.FWH_TEST_WORKSPACE_EMAIL,domain=env.FWH_TEST_WORKSPACE_DOMAIN;
  const internal=env.FWH_TEST_INTERNAL_SHARED_DRIVE_ID;
  const clientDrive=env.FWH_TEST_CLIENT_SHARED_DRIVE_ID;
  const root=env.FWH_TEST_CLIENT_ROOT_FOLDER_ID;
  if(!MAIL.test(email??'')||typeof domain!=='string'
    ||email.toLowerCase().split('@')[1]!==domain.toLowerCase()
    ||env.FWH_TEST_WORKSPACE_SCOPE!==SCOPE)deny('EXACT_TEST_WORKSPACE_REQUIRED');
  if(!ID.test(internal??'')||!ID.test(clientDrive??'')||!ID.test(root??'')
    ||new Set([internal,clientDrive,root]).size!==3)
    deny('DISTINCT_TEST_ROOT_REQUIRED');
  return {email,internal,clientDrive,root};
}
function validState(value,config){
  if(!ownKeys(value,['format','drive','root','spec'])||value.format!=='FWH_TEST_FOLDER_V1'
    ||value.drive!==config.clientDrive||value.root!==config.root)
    deny('SAVED_PROBE_IDENTITY_MISMATCH');
  const s=value.spec;
  const props=s?.appProperties;
  if(!ownKeys(s,['id','parent','name','mime','appProperties'])
    ||!ID.test(s.id??'')||s.parent!==config.root
    ||s.mime!=='application/vnd.google-apps.folder'
    ||typeof s.name!=='string'||!/^FWH DISPOSABLE TEST [0-9a-f]{12}$/.test(s.name)
    ||!ownKeys(props,['fwh_org','fwh_company','fwh_destination','fwh_kind','fwh_key'])
    ||props.fwh_kind!=='ADDRESS'
    ||!['fwh_org','fwh_company','fwh_destination'].every(k=>
       /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(props[k]??''))
    ||!/^[0-9a-f]{64}$/.test(props.fwh_key??''))
    deny('SAVED_PROBE_IDENTITY_MISMATCH');
  return s;
}
export async function runDisposableFolderProbe({
  env,fetcher=fetch,journal,mode='preflight'
}={}){
  if(!['preflight','execute','verify'].includes(mode)||!journal
    ||typeof journal.read!=='function'||typeof journal.reserve!=='function')
    deny('INVALID_PROBE_MODE');
  const config=validateProofConfiguration(env);
  const safeFetch=(url,options={})=>fetcher(url,{
    ...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  const refresh=createWorkspaceTokenProvider({
    clientId:env.FWH_TEST_WORKSPACE_CLIENT_ID,
    clientSecret:env.FWH_TEST_WORKSPACE_CLIENT_SECRET,
    refreshToken:env.FWH_TEST_WORKSPACE_REFRESH_TOKEN,
    requiredScope:SCOPE,fetcher:safeFetch
  });
  const {accessToken}=await refresh();
  const drive=createDriveClient({accessToken,fetcher:safeFetch});
  await drive.verifyProviderIdentity(config.email);
  await drive.verifyDestination({folderId:config.root,expectedDriveId:config.clientDrive});
  if(mode==='preflight')
    return {status:'TEST_ROOT_REVERIFIED',writes:false};
  let saved=await journal.read();
  let created=false;
  if(saved===null){
    if(mode==='verify')deny('NO_ORIGINAL_PROBE_TO_VERIFY');
    const [id]=await drive.generateIds(1);
    if(!ID.test(id??''))deny('NO_PREALLOCATED_TEST_ID');
    const name='FWH DISPOSABLE TEST '+randomBytes(6).toString('hex');
    const spec={id,parent:config.root,name,mime:'application/vnd.google-apps.folder',
      appProperties:{
        fwh_org:randomUUID(),fwh_company:randomUUID(),
        fwh_destination:randomUUID(),fwh_kind:'ADDRESS',
        fwh_key:createHash('sha256').update(name).digest('hex')
      }};
    saved={format:'FWH_TEST_FOLDER_V1',drive:config.clientDrive,
      root:config.root,spec};
    validState(saved,config);
    // Durable, exclusive reservation BEFORE POST. On any failure re-run VERIFY only.
    await journal.reserve(saved);
    created=true;
    try{await drive.createPreallocatedFolder(spec);}
    catch{ /* Independent exact-ID GET below is the only safe reconciliation. */ }
  }
  const spec=validState(saved,config);
  // GET by reserved identity; neither 404 nor a lost POST is authority to create again.
  const got=await drive.verifyFile({id:spec.id,parent:spec.parent,mime:spec.mime,
    name:spec.name,expectedDriveId:config.clientDrive,
    sha256:null,size:null,appProperties:spec.appProperties});
  if(got.drive_id!==config.clientDrive||got.trashed!==false)
    deny('TEST_FOLDER_RECEIPT_UNVERIFIED');
  // Independent bounded lookup within the exact TEST Shared Drive and parent.
  const url=new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q',"'"+config.root+"' in parents and name = '"+spec.name+"' and trashed = false");
  url.searchParams.set('corpora','drive');
  url.searchParams.set('driveId',config.clientDrive);
  url.searchParams.set('supportsAllDrives','true');
  url.searchParams.set('includeItemsFromAllDrives','true');
  url.searchParams.set('pageSize','100');
  url.searchParams.set('fields','nextPageToken,files(id,name,mimeType,parents,driveId,trashed,appProperties)');
  const response=await safeFetch(url.toString(),{headers:{Authorization:'Bearer '+accessToken}});
  if(response.status!==200)deny('TEST_FOLDER_LOOKUP_UNVERIFIED');
  const raw=await response.text();
  if(raw.length>16384)deny('TEST_FOLDER_LOOKUP_UNVERIFIED');
  let value;
  try{value=JSON.parse(raw);}catch{deny('TEST_FOLDER_LOOKUP_UNVERIFIED');}
  if(!Array.isArray(value.files)||value.files.length!==1||value.nextPageToken)
    deny('TEST_FOLDER_LOOKUP_UNVERIFIED');
  const f=value.files[0];
  if(f.id!==spec.id||f.name!==spec.name||f.driveId!==config.clientDrive
    ||f.trashed!==false||f.mimeType!==spec.mime
    ||!Array.isArray(f.parents)||f.parents.length!==1||f.parents[0]!==config.root
    ||!ownKeys(f.appProperties,Object.keys(spec.appProperties))
    ||Object.entries(spec.appProperties).some(([k,v])=>f.appProperties[k]!==v))
    deny('TEST_FOLDER_LOOKUP_UNVERIFIED');
  return {status:created?'TEST_FOLDER_CREATED_AND_VERIFIED':'SAME_TEST_FOLDER_REVERIFIED',
    writes:created};
}
async function privateConnection(){
  const fileNames=await (await import('node:fs/promises')).readdir(HOME);
  const dir=await lstat(HOME);
  if(!dir.isDirectory()||(dir.mode&0o077)!==0
    ||(process.getuid&&dir.uid!==process.getuid()))deny('PRIVATE_DIRECTORY_REQUIRED');
  const eligible=[];
  for(const name of fileNames){
    if(!/^[A-Za-z0-9_-]+\.json$/.test(name)||name==='phase5-disposable-folder-proof.json')continue;
    const path=join(HOME,name);
    const stat=await lstat(path);
    if(!stat.isFile()||(stat.mode&0o077)!==0
      ||(process.getuid&&stat.uid!==process.getuid())||stat.size>16384)continue;
    const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    let value;
    try{value=JSON.parse(await fd.readFile('utf8'));}catch{continue;}
    finally{await fd.close();}
    if(value?.FWH_TEST_EVIDENCE_CLASS===MARK
      &&typeof value.FWH_TEST_WORKSPACE_REFRESH_TOKEN==='string')eligible.push(value);
  }
  if(eligible.length!==1)deny('ONE_PRIVATE_TEST_CONNECTION_REQUIRED');
  return eligible[0];
}
const journal={
  async read(){
    let raw;
    try{const stat=await lstat(JOURNAL);
      if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>16384
        ||(process.getuid&&stat.uid!==process.getuid()))
        deny('PRIVATE_TEST_JOURNAL_REQUIRED');
      const fd=await open(JOURNAL,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{raw=await fd.readFile('utf8');}finally{await fd.close();}
    }catch(e){if(e.code==='ENOENT')return null;throw e;}
    try{return JSON.parse(raw);}catch{deny('PRIVATE_TEST_JOURNAL_REQUIRED');}
  },
  async reserve(value){
    const fd=await open(JOURNAL,'wx',0o600);
    try{await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();}
    finally{await fd.close();}
    // Persist the directory entry too, before ANY remote create attempt.
    const directory=await open(HOME,constants.O_RDONLY|constants.O_DIRECTORY);
    try{await directory.sync();}finally{await directory.close();}
  }
};
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  preferIPv4ForLocalWorkspaceBootstrap();
  const arg=process.argv.slice(2);
  const mode=arg.length===1&&arg[0]==='--execute'?'execute'
    :arg.length===1&&arg[0]==='--verify'?'verify'
    :arg.length===0?'preflight':null;
  (async()=>{
    if(!mode)deny('INVALID_PROBE_MODE');
    const env=await privateConnection();
    const result=await runDisposableFolderProbe({env,journal,mode});
    process.stdout.write('PASS: '+result.status+'. No Send, photo or permission changes.\n');
  })().catch(e=>{
    const codes=new Set(['TEST_ONLY_EVIDENCE_REQUIRED','EXACT_TEST_WORKSPACE_REQUIRED',
      'DISTINCT_TEST_ROOT_REQUIRED','PRIVATE_DIRECTORY_REQUIRED',
      'ONE_PRIVATE_TEST_CONNECTION_REQUIRED','PRIVATE_TEST_JOURNAL_REQUIRED',
      'INVALID_PROBE_MODE','SAVED_PROBE_IDENTITY_MISMATCH',
      'NO_ORIGINAL_PROBE_TO_VERIFY','NO_PREALLOCATED_TEST_ID',
      'TEST_FOLDER_RECEIPT_UNVERIFIED','TEST_FOLDER_LOOKUP_UNVERIFIED']);
    // Never expose provider response bodies, paths, tokens, account or remote IDs.
    process.stderr.write('BLOCKED: '+(codes.has(e?.code)?e.code
      :'TEST_FOLDER_PROVIDER_UNVERIFIED')+'\n');
    process.exitCode=1;
  });
}
