const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createHash,webcrypto} = require('node:crypto');
const source = fs.readFileSync(require.resolve('../../dashboard/recovery.js'),'utf8');

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const raw=Uint8Array.from([255,216,255,225,42,43,44,45,255,217]);
const sha=createHash('sha256').update(raw).digest('hex');
const receipt=n=>({
  photo_id:id(n),transfer_version:id(100+n),
  prepared_sha256:sha,prepared_size:raw.length,captured_at:'SYNTHETIC'
});
const signer=n=>({
  photo_id:id(n),transfer_version:id(100+n),expires_in:120,
  url:'https://test.supabase.co/storage/v1/object/sign/fwh-review-private/TEST?token=opaque'
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const releaseLater=()=>{let release;return {promise:new Promise(ok=>{release=ok;}),release};};
function node(tag='div'){
  const classes=new Set(['hidden']),actions=new Map();
  const v={
    children:[],disabled:false,hidden:false,style:{},textContent:'',href:'',download:'',
    classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),
      contains:c=>classes.has(c),toggle:(c,yes)=>yes?classes.add(c):classes.delete(c)},
    append(...items){this.children.push(...items);},
    replaceChildren(...items){this.children=items;},
    get childElementCount(){return this.children.length;},
    setAttribute(){},removeAttribute(key){delete this[key];},
    addEventListener:(key,fn)=>actions.set(key,fn),
    click:()=>actions.get('click')?.(),
    remove(){}
  };
  return v;
}
function rig({bytes=raw,delayFetch=null}={}){
  const uploads=[],signed=[],blobs=[],routes=[],fileClicks=[];
  class TestURL extends URL {
    static createObjectURL(blob){blobs.push(blob);return 'blob:synthetic';}
    static revokeObjectURL(){}
  }
  const shell=node(),page=node(),login=node();
  const answers=[];
  const ctx={
    URL:TestURL,Blob,TextEncoder,DataView,Uint8Array,crypto:webcrypto,
    setTimeout:fn=>fn(),
    SUPABASE_URL:'https://test.supabase.co',
    accessToken:'token-a',currentUser:{id:'account-a'},
    loginCard:login,resultsCard:page,signOutButton:node('button'),
    authHeaders:()=>({Authorization:'Bearer TEST'}),
    readableError:async()=>'TEST failure',
    document:{
      createElement(tag){
        const v=node(tag);
        if(tag==='a')v.click=()=>{fileClicks.push({href:v.href,download:v.download});};
        return v;
      },
      querySelector:key=>{assert.equal(key,'main.shell');return shell;},
      getElementById:()=>null
    },
    adminFetch:async url=>{
      routes.push(String(url));
      const answer=answers.shift();
      assert.ok(answer,'Expected a test-only RPC or short signer response');
      if(url.includes('/recovery-private-photo'))signed.push(url);
      return {ok:true,json:async()=>answer};
    },
    fetch:async (_url,opts)=>{
      uploads.push({...opts});
      if(delayFetch)await delayFetch;
      return {
        ok:true,
        blob:async()=>new Blob([bytes],{type:'image/jpeg'})
      };
    }
  };
  vm.runInNewContext(source+'\nthis.gallery=RecoveryGallery;',ctx);
  const card=shell.children[0],controls=card.children[5];
  return {ctx,card,rows:card.children[3],status:card.children[2],
    add:controls.children[2],zip:controls.children[3],
    gallery:ctx.gallery,
    uploads,signed,blobs,fileClicks,routes,
    enqueue:answer=>answers.push(answer)
  };
}
async function select(x,n,index){
  x.enqueue(signer(n));
  x.rows.children[index].click();
  await tick();
  assert.equal(x.add.disabled,false,'Authorized inspected photo can be selected');
  x.add.click();
}
async function exportNow(x,photos){
  for(const n of photos)x.enqueue(signer(n));
  assert.equal(x.zip.disabled,false,'Explicitly selected receipts allow an export');
  x.zip.click();
  // SHA-256 and Blob.arrayBuffer complete asynchronously outside the VM.
  // A count of fast event-loop ticks can expire before worker-thread crypto
  // settles on a busy CI runner. Observe the actual busy state, with a
  // wall-clock safety deadline so a hung export still fails this test.
  const deadline=Date.now()+2000;
  while(x.zip.disabled && Date.now()<deadline)
    await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(x.zip.disabled,false,'Bounded archive work must settle');
}
test('one explicitly selected bounded archive contains only exact checksum-verified JPEGs',async()=>{
  const x=rig();
  x.enqueue({photos:[receipt(1),receipt(2)],next_photo:null});
  await x.gallery.show();
  await select(x,1,0);await select(x,2,1);
  assert.match(x.zip.textContent,/2\/8/);
  await exportNow(x,[1,2]);
  assert.equal(x.fileClicks.length,1);
  assert.equal(x.fileClicks[0].download,'fwh-recovered-evidence.zip');
  assert.equal(x.blobs.length,1);
  assert.equal(x.blobs[0].type,'application/zip');
  const zip=Buffer.from(await x.blobs[0].arrayBuffer());
  const names=[];
  let at=0;
  for(const n of [1,2]){
    assert.equal(zip.readUInt32LE(at),0x04034b50,'Each member has a local ZIP header');
    const nameLength=zip.readUInt16LE(at+26),name=zip.subarray(at+30,at+30+nameLength).toString();
    names.push(name);
    const body=zip.subarray(at+30+nameLength,at+30+nameLength+raw.length);
    assert.deepEqual(body,Buffer.from(raw),'Only exact checksum-verified bytes enter archive');
    at+=30+nameLength+raw.length;
  }
  assert.deepEqual(names,[1,2].map(n=>'fwh-recovered-'+id(n)+'.jpg'));
  assert.equal(zip.readUInt32LE(at),0x02014b50,'Central directory follows verified members');
  assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50,'ZIP end record is emitted');
  assert.equal(zip.readUInt16LE(zip.length-22+10),2);
  assert.equal(x.uploads.length,2);
  assert.ok(x.uploads.every(o=>o.credentials==='omit'&&o.redirect==='error'));
  assert.equal(x.routes.filter(url=>url.includes('photo_recovery_page')).length,1,
    'Local archive does not broaden the server gallery');
});
test('corrupted bytes reject the entire export without a partial archive',async()=>{
  const wrong=Uint8Array.from(raw);wrong[4]^=1;
  const x=rig({bytes:wrong});
  x.enqueue({photos:[receipt(1)],next_photo:null});
  await x.gallery.show();
  await select(x,1,0);
  await exportNow(x,[1]);
  assert.equal(x.blobs.length,0);
  assert.equal(x.fileClicks.length,0);
  assert.match(x.status.textContent,/checksum verification/);
  assert.equal(x.zip.disabled,false,'Retry remains possible after a known-safe download failure');
});
test('changed Auth token while archive bytes are in flight discards old bytes',async()=>{
  const waiting=releaseLater();
  const x=rig({delayFetch:waiting.promise});
  x.enqueue({photos:[receipt(1)],next_photo:null});
  await x.gallery.show();
  await select(x,1,0);
  x.enqueue(signer(1));
  x.zip.click();
  await tick();
  x.gallery.reset();
  x.ctx.accessToken='token-b';
  waiting.release();
  await tick();await tick();
  assert.equal(x.blobs.length,0);
  assert.equal(x.fileClicks.length,0);
  assert.equal(x.zip.disabled,true);
});
test('export selection is unique, session-scoped, and at most eight receipts',async()=>{
  const x=rig();
  x.enqueue({photos:Array.from({length:9},(_,i)=>receipt(i+1)),next_photo:null});
  await x.gallery.show();
  for(let n=1;n<=8;n++)await select(x,n,n-1);
  assert.match(x.zip.textContent,/8\/8/);
  assert.equal(x.add.disabled,false,'A full batch must still permit removing the selected item');
  assert.match(x.add.textContent,/Remove selected/);
  x.add.click();
  assert.match(x.zip.textContent,/7\/8/);
  assert.match(x.add.textContent,/Add selected/);
  x.gallery.reset();
  assert.match(x.zip.textContent,/0\/8/);
  assert.equal(x.zip.disabled,true);
  assert.equal(x.blobs.length,0);
});

test('recovery ZIP selection can remove an accidental photo, then re-add before export',async()=>{
  const x=rig();
  x.enqueue({photos:[receipt(1),receipt(2)],next_photo:null});
  await x.gallery.show();
  await select(x,1,0);
  await select(x,2,1);
  assert.match(x.zip.textContent,/2\/8/);
  assert.match(x.add.textContent,/Remove selected/);
  x.add.click();
  assert.match(x.zip.textContent,/1\/8/);
  assert.match(x.add.textContent,/Add selected/);
  assert.equal(x.add.disabled,false);
  await exportNow(x,[1]);
  assert.equal(x.fileClicks.length,1);
  const archive=Buffer.from(await x.blobs[0].arrayBuffer());
  assert.equal(archive.readUInt16LE(archive.length-22+10),1);
  assert.equal(archive.includes(Buffer.from(id(2))),false,
    'Removed photo identity cannot remain in evidence archive');
  assert.equal(x.uploads.length,1,'Removed photo is never fetched for export');
});

test('receipt-byte budget is enforced before network download, and removal makes room',async()=>{
  const big1={...receipt(1),prepared_size:32*1024*1024};
  const big2={...receipt(2),prepared_size:32*1024*1024};
  const small=receipt(3);
  const x=rig();
  x.enqueue({photos:[big1,big2,small],next_photo:null});
  await x.gallery.show();
  await select(x,1,0);
  await select(x,2,1);
  assert.match(x.zip.textContent,/2\/8/);
  x.enqueue(signer(3));
  x.rows.children[2].click();
  await tick();
  assert.equal(x.add.disabled,true,'Third JPEG exceeding 64 MiB must be unselectable');
  assert.match(x.status.textContent,/Remove another photo/);
  assert.equal(x.uploads.length,0,'No large private bytes are fetched for selection');
  // Go back to an already-selected photo: removal is always possible.
  x.enqueue(signer(1));
  x.rows.children[0].click();
  await tick();
  assert.equal(x.add.disabled,false);
  assert.match(x.add.textContent,/Remove selected/);
  x.add.click();
  assert.match(x.zip.textContent,/1\/8/);
  x.enqueue(signer(3));
  x.rows.children[2].click();
  await tick();
  assert.equal(x.add.disabled,false,'Removing a large JPEG makes room for a small one');
  x.add.click();
  assert.match(x.zip.textContent,/2\/8/);
  assert.equal(x.uploads.length,0);
});
