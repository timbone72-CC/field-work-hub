// Encrypt private Drive resumable session capabilities before DB persistence.
// This is NOT a deployed provider. A lost encryption key is a real recovery
// blocker and must not trigger a new preallocated file or blind create.
const FIXED='https://www.googleapis.com/upload/drive/v3/files';
const ID=/^[A-Za-z0-9_-]{10,160}$/;
const PREFIX='FWH-DRIVE-SESSION-V1';
function base64url(bytes) {
  let value='';for(const b of bytes)value+=String.fromCharCode(b);
  return btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function from64(value) {
  if(typeof value!=='string'||value.length>10240||!/^[A-Za-z0-9_-]+$/.test(value))
    throw Error('SESSION_CIPHERTEXT_INVALID');
  const decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(decoded,c=>c.charCodeAt(0));
}
const text=v=>new TextEncoder().encode(v);
export async function createSessionVault({base64Key,subtle=crypto.subtle,random=crypto.getRandomValues.bind(crypto)}={}){
  let keyBytes;
  try{keyBytes=from64(base64Key);}catch{throw Error('BACKEND_SESSION_KEY_REQUIRED');}
  if(keyBytes.length!==32)throw Error('BACKEND_SESSION_KEY_REQUIRED');
  const key=await subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
  // Bind ciphertext to exact package, reserved ID and role before any restore.
  const aad=({packageId,fileId})=>{
    if(!ID.test(packageId??'')||!ID.test(fileId??''))
      throw Error('EXACT_SESSION_IDENTITY_REQUIRED');
    return text(PREFIX+'|'+packageId+'|'+fileId);
  };
  const validateUrl=val=>{
    let u;try{u=new URL(val);}catch{throw Error('UNTRUSTED_UPLOAD_SESSION');}
    if(u.href.startsWith(FIXED)===false||u.origin!=='https://www.googleapis.com'
      ||u.pathname!=='/upload/drive/v3/files'||u.username||u.password||u.hash
      ||u.searchParams.size!==2||u.searchParams.get('uploadType')!=='resumable'
      ||!u.searchParams.get('upload_id'))throw Error('UNTRUSTED_UPLOAD_SESSION');
    return u.toString();
  };
  return {
    async seal(url,identity) {
      const safe=validateUrl(url);
      const iv=random(new Uint8Array(12));
      if(!(iv instanceof Uint8Array)||iv.length!==12)throw Error('SECURE_NONCE_UNAVAILABLE');
      const bytes=await subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(identity)},key,text(safe));
      return {version:1,nonce:base64url(iv),payload:base64url(new Uint8Array(bytes))};
    },
    async open(blob,identity) {
      if(!blob||blob.version!==1)throw Error('SESSION_CIPHERTEXT_INVALID');
      let plaintext;
      try{plaintext=await subtle.decrypt({name:'AES-GCM',iv:from64(blob.nonce),
        additionalData:aad(identity)},key,from64(blob.payload));}
      catch{throw Error('SESSION_CIPHERTEXT_OR_IDENTITY_MISMATCH');}
      return validateUrl(new TextDecoder().decode(plaintext));
    }
  };
}
