import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionVault} from '../../supabase/functions/client-delivery/session-vault.mjs';
const bytes=crypto.getRandomValues(new Uint8Array(32));
const b64=b=>btoa(String.fromCharCode(...b)).replace(/=+$/,'');
const id={packageId:'package_'+'a'.repeat(23),fileId:'drive_'+'b'.repeat(25)};
const url='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=PRIVATE-DISPOSABLE-SESSION';
test('opaque encrypted session contains no bearer URL and can recover only with exact file identity',async()=>{
 const vault=await createSessionVault({base64Key:b64(bytes)});
 const sealed=await vault.seal(url,id);
 assert.equal(sealed.version,1);
 assert.ok(!JSON.stringify(sealed).includes('PRIVATE-DISPOSABLE'));
 assert.equal(await vault.open(sealed,id),url);
 await assert.rejects(()=>vault.open(sealed,{...id,fileId:'otherfile_'+'x'.repeat(22)}),
  /SESSION_CIPHERTEXT_OR_IDENTITY_MISMATCH/);
 await assert.rejects(()=>vault.open({...sealed,payload:sealed.payload.slice(0,-1)+'A'},id),
  /SESSION_CIPHERTEXT_OR_IDENTITY_MISMATCH/);
});
test('nonce is fresh for each sealed upload session; refresh never exports key',async()=>{
 const vault=await createSessionVault({base64Key:b64(bytes)});
 const x=await vault.seal(url,id),y=await vault.seal(url,id);
 assert.notEqual(x.nonce,y.nonce);
 assert.notEqual(x.payload,y.payload);
 assert.ok(!JSON.stringify(x).includes(b64(bytes)));
});
test('session URL never accepts another origin, path, token or too many parameters',async()=>{
 const vault=await createSessionVault({base64Key:b64(bytes)});
 for(const bad of [
  'https://evil.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=1',
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=1&leak=1',
  'https://www.googleapis.com/drive/v3/files?uploadType=resumable&upload_id=1',
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=1#evil'
 ])await assert.rejects(()=>vault.seal(bad,id),/UNTRUSTED_UPLOAD_SESSION/);
});
test('no unknown encryption key length can silently produce an unrecoverable journal',async()=>{
 for(const invalid of ['bad',b64(new Uint8Array(16)),'']){
  await assert.rejects(()=>createSessionVault({base64Key:invalid}),/BACKEND_SESSION_KEY_REQUIRED/);
 }
});
