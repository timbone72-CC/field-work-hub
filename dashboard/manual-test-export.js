/* TEST-only read/export helper. Not a delivery, Send, recovery grant or cleanup owner. */
const ManualTestExport = (() => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SHA = /^[a-f0-9]{64}$/;
  const MAX_PHOTOS = 8, MAX_BYTES = 64 * 1024 * 1024;
  function checkPhoto(p) {
    if (!p || !UUID.test(p.photo_id || '') || !UUID.test(p.run_id || '')
      || !UUID.test(p.transfer_version || '') || !UUID.test(p.decision_revision || '')
      || !SHA.test(p.observed_sha256 || '') || p.decision !== 'APPROVED'
      || typeof p.verified_at !== 'string' || !p.verified_at) {
      throw Error('Exact approved private receipt and review revision required.');
    }
    return p;
  }
  function checkSigned(signed, p, org, wo, origin) {
    if (signed?.photo_id !== p.photo_id || signed?.transfer_version !== p.transfer_version
      || !Number.isInteger(signed.expires_in) || signed.expires_in < 1 || signed.expires_in > 300
      || typeof signed.url !== 'string') throw Error('Untrusted private signed-photo response.');
    const parts = [org, wo, p.run_id, p.photo_id + '.jpg'];
    if (!UUID.test(org || '') || !UUID.test(wo || '')) throw Error('Exact TEST organization and WO required.');
    const url = new URL(signed.url);
    const expectedPath = '/storage/v1/object/sign/fwh-review-private/' +
      parts.map(encodeURIComponent).join('/');
    if (url.protocol !== 'https:' || url.origin !== origin || url.pathname !== expectedPath
      || url.username || url.password || url.hash || url.searchParams.size !== 1
      || !url.searchParams.get('token')) throw Error('Untrusted private object URL.');
    return url.toString();
  }
  async function readExact(p, options) {
    checkPhoto(p);
    const {org, wo, origin, signer, fetcher, current} = options;
    const alive = () => {
      if (!current()) throw Error('Admin session, job or selection changed; TEST export cancelled.');
    };
    alive();
    const signed = await signer({photo_id:p.photo_id,transfer_version:p.transfer_version});
    alive();
    const url = checkSigned(signed,p,org,wo,origin);
    const safe = {redirect:'error',credentials:'omit',cache:'no-store'};
    const head = await fetcher(url,{...safe,method:'HEAD'});
    alive();
    if (!head.ok || !/^image\/jpeg(?:\s*;|$)/i.test(head.headers.get('Content-Type') || ''))
      throw Error('Exact private JPEG HEAD verification unavailable.');
    const sizeText = head.headers.get('Content-Length') || '';
    if (!/^[1-9][0-9]*$/.test(sizeText)) throw Error('Private JPEG length unavailable.');
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 4 || size > MAX_BYTES)
      throw Error('Private JPEG exceeds TEST export size bound.');
    const response = await fetcher(url,{...safe,method:'GET'});
    alive();
    if (!response.ok || !/^image\/jpeg(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')
      || response.headers.get('Content-Length') !== sizeText || !response.body)
      throw Error('Private JPEG response identity/length mismatch.');
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    try {
      while (true) {
        alive();
        const {value,done} = await reader.read();
        alive();
        if (done) break;
        if (!(value instanceof Uint8Array) || value.length < 1)
          throw Error('Invalid private JPEG chunk.');
        total += value.length;
        if (total > size || total > MAX_BYTES) throw Error('Private JPEG length exceeded.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(()=>{});
      reader.releaseLock();
    }
    if (total !== size) throw Error('Private JPEG length mismatch.');
    const file = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) {file.set(chunk,position);position += chunk.length;}
    if (file[0] !== 255 || file[1] !== 216 || file[2] !== 255
      || file[size-2] !== 255 || file[size-1] !== 217)
      throw Error('Private JPEG completeness check failed.');
    const digest = await crypto.subtle.digest('SHA-256',file);
    alive();
    const sha = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    if (sha !== p.observed_sha256) throw Error('Verified private receipt checksum mismatch.');
    return {photo:p,file,size,sha};
  }
  function crc32(bytes) {
    let crc = -1;
    for (const b of bytes) {
      crc ^= b;
      for (let bit=0;bit<8;bit++)
        crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    return (crc^-1)>>>0;
  }
  function zip(entries) {
    // The local-only manifest keeps exact original receipt hashes alongside the
    // disposable copies. It is NOT a client submission or delivery receipt.
    const manifest=new TextEncoder().encode(
      'FWH MANUAL TEST TRANSFER ONLY - NOT CLIENT DELIVERED\\n'+
      'No automatic FWH receipt, Send or original cleanup.\\n'+
      entries.map(e=>e.photo.photo_id+'  '+e.sha+'  '+e.size+' bytes').join('\\n')+'\\n');
    const files=[...entries,{file:manifest,filename:'manual-test-sha256.txt'}];
    const parts=[], directory=[];let offset=0,central=0;
    const put16=(v,n,x)=>v.setUint16(n,x,true);
    const put32=(v,n,x)=>v.setUint32(n,x,true);
    for(const entry of files) {
      const name=new TextEncoder().encode(entry.filename||('manual-test-'+entry.photo.photo_id+'.jpg'));
      const size=entry.file.length, crc=crc32(entry.file);
      const h=new Uint8Array(30+name.length),hv=new DataView(h.buffer);
      put32(hv,0,0x04034b50);put16(hv,4,20);put16(hv,10,0);
      put16(hv,12,33);put32(hv,14,crc);put32(hv,18,size);put32(hv,22,size);
      put16(hv,26,name.length);h.set(name,30);
      parts.push(h,entry.file);
      const d=new Uint8Array(46+name.length),dv=new DataView(d.buffer);
      put32(dv,0,0x02014b50);put16(dv,4,20);put16(dv,6,20);
      put16(dv,14,33);put32(dv,16,crc);put32(dv,20,size);put32(dv,24,size);
      put16(dv,28,name.length);put32(dv,42,offset);d.set(name,46);
      directory.push(d);central+=d.length;offset+=h.length+size;
    }
    const end=new Uint8Array(22),ev=new DataView(end.buffer);
    put32(ev,0,0x06054b50);put16(ev,8,files.length);put16(ev,10,files.length);
    put32(ev,12,central);put32(ev,16,offset);
    return new Blob([...parts,...directory,end],{type:'application/zip'});
  }
  async function makeArchive(photos,options) {
    if (!Array.isArray(photos) || photos.length<1 || photos.length>MAX_PHOTOS)
      throw Error('Select 1–8 approved TEST photos.');
    const ids=new Set();
    for(const p of photos) {
      checkPhoto(p);
      if(ids.has(p.photo_id)) throw Error('Duplicate selected TEST photo.');
      ids.add(p.photo_id);
    }
    const entries=[];let total=0;
    for(const p of photos) {
      const result=await readExact(p,options);
      total+=result.size;
      if(total>MAX_BYTES) throw Error('TEST archive exceeds 64 MiB.');
      entries.push(result);
    }
    if (!options.current()) throw Error('Admin session changed before archive could be saved.');
    const blob=zip(entries);
    if(blob.size>MAX_BYTES)throw Error('Manual TEST ZIP exceeds 64 MiB including metadata.');
    return {blob,count:entries.length,bytes:total,
      hashes:entries.map(x=>({photo_id:x.photo.photo_id,sha256:x.sha,size:x.size}))};
  }
  return {checkPhoto,checkSigned,makeArchive,MAX_PHOTOS,MAX_BYTES};
})();
if (typeof module!=='undefined'&&module.exports) module.exports=ManualTestExport;
