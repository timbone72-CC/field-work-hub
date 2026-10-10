// Pure trusted Google Drive v3 adapter. NO browser integration or scheduler.
// Call only with a secure, server-obtained OAuth token and PREALLOCATED IDs
// already persisted under the exact fenced client-delivery attempt.
// HTTP failures never authorize a different remote ID or blind retry.
const DRIVE_ORIGIN='https://www.googleapis.com';
const ID=/^[A-Za-z0-9_-]{10,160}$/;
const PARENT=/^[A-Za-z0-9_-]{3,160}$/;
const HASH=/^[0-9a-f]{64}$/;
const MIME=new Set(['image/jpeg','application/json','application/vnd.google-apps.folder']);
const CHUNK=256*1024;
export class DriveUncertain extends Error {
  constructor(code){super(code);this.name='DriveUncertain';this.code=code;}
}
function valid(value,rx,code){if(typeof value!=='string'||!rx.test(value))throw new DriveUncertain(code);return value;}
function fixedObject({id,parent,name,mime,appProperties}) {
  valid(id,ID,'PREALLOCATED_ID_REQUIRED');valid(parent,PARENT,'PARENT_ID_REQUIRED');
  if(typeof name!=='string'||name.length<1||name.length>160||name.includes('/')||/[\\\x00-\x1f]/.test(name))
    throw new DriveUncertain('INVALID_REMOTE_NAME');
  if(!MIME.has(mime))throw new DriveUncertain('MIME_NOT_ALLOWED');
  if(!appProperties||typeof appProperties!=='object'||Array.isArray(appProperties)
    ||!ID.test(appProperties.fwh_package??'')||!HASH.test(appProperties.fwh_manifest??''))
    throw new DriveUncertain('EXACT_APP_PROPERTIES_REQUIRED');
  return {id,name,mimeType:mime,parents:[parent],appProperties};
}
function sessionUrl(value){
  let u;
  try {u=new URL(value);}catch{throw new DriveUncertain('UNTRUSTED_UPLOAD_SESSION');}
  if(u.protocol!=='https:'||u.origin!==DRIVE_ORIGIN||u.username||u.password||u.hash
    ||u.pathname!=='/upload/drive/v3/files'
    ||u.searchParams.get('uploadType')!=='resumable'
    ||!u.searchParams.get('upload_id')||u.searchParams.size!==2)
    throw new DriveUncertain('UNTRUSTED_UPLOAD_SESSION');
  return u.toString();
}
function handleHttp(response,expected){
  if(expected.includes(response.status))return response;
  // 404 is NOT permission to create a new object: inaccessible/missing are ambiguous.
  throw new DriveUncertain(response.status===401||response.status===403?'PROVIDER_AUTH_DENIED'
    :response.status===404||response.status===410?'PROVIDER_IDENTITY_UNCERTAIN'
    :response.status===409?'REMOTE_ID_CONFLICT_RECONCILE'
    :response.status===429||response.status>=500?'PROVIDER_RETRY_REQUIRED'
    :'PROVIDER_RESPONSE_UNCERTAIN');
}
async function boundedJson(response){
  const type=response.headers.get('Content-Type')||'';
  if(type && !type.includes('json'))throw new DriveUncertain('PROVIDER_RESPONSE_UNCERTAIN');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.byteLength>16384)throw new DriveUncertain('PROVIDER_RESPONSE_TOO_LARGE');
  try{return JSON.parse(new TextDecoder().decode(bytes));}
  catch{throw new DriveUncertain('PROVIDER_RESPONSE_UNCERTAIN');}
}
export function createDriveClient({accessToken,fetcher=fetch}){
  if(typeof accessToken!=='string'||!/^[-._~+\/A-Za-z0-9]{20,8192}$/.test(accessToken))
    throw new DriveUncertain('SERVER_OAUTH_TOKEN_REQUIRED');
  const request=async(url,options={})=>{
    const origin=new URL(url);
    if(origin.origin!==DRIVE_ORIGIN)throw new DriveUncertain('UNTRUSTED_DRIVE_ORIGIN');
    // Authorization is sent only to fixed Google host; redirects cannot forward it.
    return fetcher(origin.toString(),{...options,redirect:'error',
      headers:{Authorization:'Bearer '+accessToken,...(options.headers||{})}});
  };
  const get=async(id)=>{
    valid(id,ID,'REMOTE_ID_REQUIRED');
    const fields='id,name,mimeType,parents,sha256Checksum,size,appProperties,trashed,driveId,capabilities(canAddChildren)';
    const url=new URL('/drive/v3/files/'+encodeURIComponent(id),DRIVE_ORIGIN);
    url.searchParams.set('fields',fields);url.searchParams.set('supportsAllDrives','true');
    const response=handleHttp(await request(url),[200]);
    return boundedJson(response);
  };
  return {
    async verifyProviderIdentity(expectedEmail){
      if(typeof expectedEmail!=='string'||!/^[-._+a-z0-9]+@[-.a-z0-9]+\.[a-z]{2,}$/i.test(expectedEmail))
        throw new DriveUncertain('CONFIGURED_ACCOUNT_REQUIRED');
      const url=new URL('/drive/v3/about',DRIVE_ORIGIN);
      url.searchParams.set('fields','user(emailAddress,permissionId,me)');
      const r=handleHttp(await request(url),[200]);
      const about=await boundedJson(r);
      if(about.user?.emailAddress?.toLowerCase()!==expectedEmail.toLowerCase()
        ||about.user?.me!==true||!about.user.permissionId)
        throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
      return {account:about.user.emailAddress.toLowerCase(),permission_id:about.user.permissionId};
    },
    async verifyDestination({folderId,expectedDriveId=null}){
      valid(folderId,PARENT,'DESTINATION_ID_REQUIRED');
      if(expectedDriveId!==null)valid(expectedDriveId,PARENT,'EXPECTED_SHARED_DRIVE_REQUIRED');
      const f=await get(folderId);
      if(f.id!==folderId||f.trashed!==false
        ||f.mimeType!=='application/vnd.google-apps.folder'
        ||f.capabilities?.canAddChildren!==true
        ||(expectedDriveId!==null&&f.driveId!==expectedDriveId))
        throw new DriveUncertain('DESTINATION_NOT_VERIFIED');
      return {id:f.id,drive_id:f.driveId??null,can_add_children:true};
    },
    async generateIds(count){
      if(!Number.isInteger(count)||count<1||count>200)throw new DriveUncertain('BOUNDED_ID_REQUEST_REQUIRED');
      const url=new URL('/drive/v3/files/generateIds',DRIVE_ORIGIN);
      url.searchParams.set('count',String(count));url.searchParams.set('space','drive');
      const resp=handleHttp(await request(url),[200]);
      const json=await boundedJson(resp);
      if(!Array.isArray(json.ids)||json.ids.length!==count||new Set(json.ids).size!==count
        ||json.ids.some(id=>!ID.test(id)))throw new DriveUncertain('GENERATED_IDS_UNCERTAIN');
      return json.ids;
    },
    async verifyFile({id,parent,mime,sha256,size,appProperties}){
      const file=await get(id);
      if(file.id!==valid(id,ID,'REMOTE_ID_REQUIRED')||file.trashed===true
        ||file.mimeType!==mime||!Array.isArray(file.parents)
        ||file.parents.length!==1||file.parents[0]!==parent
        ||!appProperties||Object.keys(appProperties).some(k=>file.appProperties?.[k]!==appProperties[k]))
        throw new DriveUncertain('REMOTE_FILE_IDENTITY_MISMATCH');
      if(mime==='application/vnd.google-apps.folder'){
        if(sha256!=null||size!=null)throw new DriveUncertain('FOLDER_BYTES_UNEXPECTED');
      } else {
        if(!HASH.test(sha256??'')||!Number.isSafeInteger(size)||size<=0
          ||file.sha256Checksum!==sha256||String(file.size)!==String(size))
          // An absent SHA256 is not a confirmed upload. Later worker may perform
          // a streamed byte re-read before producing the equivalent proof.
          throw new DriveUncertain('REMOTE_CONTENT_UNVERIFIED');
      }
      return {id,parent,mime,sha256:sha256??null,size:size??null};
    },
    async createPreallocatedFolder(spec){
      const data=fixedObject(spec);
      if(data.mimeType!=='application/vnd.google-apps.folder')throw new DriveUncertain('FOLDER_ONLY');
      const url=new URL('/drive/v3/files',DRIVE_ORIGIN);
      url.searchParams.set('supportsAllDrives','true');
      url.searchParams.set('fields','id,name,mimeType,parents,appProperties');
      const res=handleHttp(await request(url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(data)}),[200,201]);
      const reply=await boundedJson(res);
      if(reply.id!==data.id)throw new DriveUncertain('REMOTE_CREATE_UNCERTAIN');
      // A creation response is NOT a final receipt. verifyFile() must follow.
      return {created_id:reply.id,needs_verification:true};
    },
    async startResumable(spec,{size}){
      const data=fixedObject(spec);
      if(data.mimeType==='application/vnd.google-apps.folder'
        ||!Number.isSafeInteger(size)||size<=0||size>32*1024*1024)
        throw new DriveUncertain('INVALID_UPLOAD_SIZE');
      const url=new URL('/upload/drive/v3/files',DRIVE_ORIGIN);
      url.searchParams.set('uploadType','resumable');url.searchParams.set('supportsAllDrives','true');
      url.searchParams.set('fields','id,size,sha256Checksum,parents,mimeType,appProperties');
      const r=handleHttp(await request(url,{method:'POST',headers:{
        'Content-Type':'application/json','X-Upload-Content-Type':data.mimeType,
        'X-Upload-Content-Length':String(size)},body:JSON.stringify(data)}),[200]);
      const location=r.headers.get('Location');
      if(!location)throw new DriveUncertain('UPLOAD_SESSION_UNCERTAIN');
      // Caller must store this session securely before sending first byte.
      return {session_url:sessionUrl(location),remote_id:data.id,total:size};
    },
    async probeResumable(session,total){
      const url=sessionUrl(session);
      if(!Number.isSafeInteger(total)||total<=0||total>32*1024*1024)
        throw new DriveUncertain('INVALID_UPLOAD_SIZE');
      const r=handleHttp(await request(url,{method:'PUT',
        headers:{'Content-Length':'0','Content-Range':`bytes */${total}`}}),[200,201,308]);
      if(r.status!==308)return {complete_candidate:true,requires_get_verification:true};
      const range=r.headers.get('Range');
      if(!range)return {offset:0,complete_candidate:false};
      const match=/^bytes=0-(\d+)$/.exec(range);
      const next=match?Number(match[1])+1:NaN;
      if(!Number.isSafeInteger(next)||next<0||next>=total)
        throw new DriveUncertain('RESUMABLE_OFFSET_UNCERTAIN');
      return {offset:next,complete_candidate:false};
    },
    async uploadChunk(session,total,offset,chunk){
      const url=sessionUrl(session);
      if(!(chunk instanceof Uint8Array)||!chunk.length||chunk.length>1024*1024
        ||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(total)
        ||total<=0||total>32*1024*1024||offset+chunk.length>total
        ||(offset+chunk.length!==total&&chunk.length%CHUNK!==0))
        throw new DriveUncertain('INVALID_UPLOAD_RANGE');
      const end=offset+chunk.length-1;
      const response=handleHttp(await request(url,{method:'PUT',headers:{
        'Content-Length':String(chunk.length),
        'Content-Range':`bytes ${offset}-${end}/${total}`},body:chunk}),[200,201,308]);
      // Even HTTP 201 requires an independent GET of the preallocated ID.
      return {complete_candidate:response.status!==308,requires_get_verification:true};
    }
  };
}
