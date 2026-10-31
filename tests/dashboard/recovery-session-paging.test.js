const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../dashboard/recovery.js'), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const photo = n => ({
  photo_id: id(n), transfer_version: id(n + 1000), captured_at: 'TEST CAPTURE',
  prepared_size: 100, prepared_sha256: 'a'.repeat(64)
});
const page = (numbers, next = null) => ({
  photos: numbers.map(photo), next_photo: next == null ? null : id(next)
});
const first = () => page(Array.from({length:25}, (_, i) => i + 1), 25);
const nextPage = () => page([26]);
const frame = () => new Promise(resolve => setImmediate(resolve));
const defer = () => {
  let resolve;
  return {promise:new Promise(r => { resolve = r; }), release:value => resolve(value)};
};
const response = value => ({ok:true, json:async()=>value});

function element(tag = 'div') {
  const classes = new Set();
  const handlers = new Map();
  return {
    tagName:tag,children:[],hidden:false,disabled:false,style:{},textContent:'',
    classList:{
      add:name=>classes.add(name),remove:name=>classes.delete(name),
      contains:name=>classes.has(name),toggle:(name,yes)=>{
        if(yes) classes.add(name); else classes.delete(name);
      }
    },
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children = children;},
    get childElementCount(){return this.children.length;},
    setAttribute(){},
    removeAttribute(name){delete this[name];},
    addEventListener(name,fn){handlers.set(name,fn);},
    click(){handlers.get('click')?.();},
    remove(){}
  };
}
function rig() {
  const main = element('main'), staffing = element(), requests = [], answers = [];
  const ctx = {
    document:{
      createElement:element,
      querySelector:selector=>{
        assert.equal(selector,'main.shell');
        return main;
      },
      getElementById:key=>key==='staffing-card' ? staffing : null
    },
    accessToken:'token-a',
    currentUser:{id:'user-a'},
    SUPABASE_URL:'https://example.supabase.co',
    loginCard:element(),resultsCard:element(),signOutButton:element(),
    authHeaders:()=>({Authorization:'Bearer TEST'}),
    readableError:async()=> 'Authorization failed',
    URL,
    adminFetch:async url=>{
      requests.push(String(url));
      const next = answers.shift();
      assert.ok(next,'Unexpected photo recovery request');
      return await next;
    }
  };
  vm.runInNewContext(source + '\nthis.gallery=RecoveryGallery;', ctx, {
    filename:'dashboard/recovery.js'
  });
  const card = main.children[0], rows = card.children[3],
    status = card.children[2], preview = card.children[4],
    controls = card.children[5], more = controls.children[0],
    download = controls.children[1];
  return {ctx,card,rows,status,preview,more,download,requests,
    gallery:ctx.gallery,
    enqueue(value){answers.push(Promise.resolve(response(value)));},
    enqueueDeferred(){
      const d = defer();
      answers.push(d.promise);
      return {release:value=>d.release(response(value))};
    }
  };
}

test('recovery gallery uses only strictly increasing, bounded server-authorized pages',async()=>{
  for (const bad of [
    page([2,1]),
    page([1,1]),
    page(Array.from({length:26},(_,i)=>i+1)),
    page([1],1),
    page(Array.from({length:25},(_,i)=>i+1),24)
  ]) {
    const x=rig();
    x.enqueue(bad);
    await assert.rejects(()=>x.gallery.show(),/stale or invalid/);
    assert.equal(x.rows.childElementCount,0);
    assert.equal(x.card.classList.contains('hidden'),true);
    assert.equal(x.requests.length,1,'Reject bad pagination without a second read');
  }
  const x=rig();
  x.enqueue(first());
  await x.gallery.show();
  assert.equal(x.rows.childElementCount,25);
  assert.equal(x.more.hidden,false);
  x.enqueue(page([25,26]));
  x.more.click();
  await frame();await frame();
  assert.equal(x.rows.childElementCount,25,'Repeated cursor must not append duplicate photos');
  assert.match(x.status.textContent,/stale or invalid/);
  assert.equal(x.more.disabled,false,'Current request can be retried after a bad page');
});

test('old recovery page completion cannot clear newer session busy guard or append photos',async()=>{
  const x=rig();
  x.enqueue(first());
  await x.gallery.show();
  const old=x.enqueueDeferred();
  x.more.click();
  await frame();
  assert.equal(x.more.disabled,true);

  // A same-user reauthentication is a different scoped session.
  x.gallery.reset();
  x.ctx.accessToken='token-b';
  x.enqueue(first());
  await x.gallery.show();
  const current=x.enqueueDeferred();
  x.more.click();
  await frame();
  assert.equal(x.more.disabled,true);

  old.release(nextPage());
  await frame();await frame();
  assert.equal(x.rows.childElementCount,25);
  assert.equal(x.more.disabled,true,'Old finally must not unlock a new in-flight read');

  current.release(nextPage());
  await frame();await frame();
  assert.equal(x.rows.childElementCount,26);
  assert.equal(x.more.disabled,false);
  assert.equal(x.more.hidden,true);
});

test('a same-user token replacement cannot reuse an older signed preview',async()=>{
  const x=rig();
  x.enqueue(page([1]));
  await x.gallery.show();
  const old=x.enqueueDeferred();
  x.rows.children[0].click();
  await frame();
  x.ctx.accessToken='replacement-token';
  old.release({photo_id:id(1),transfer_version:id(1001),
    url:'https://example.supabase.co/storage/v1/object/sign/fwh-review-private/test?token=fake',
    expires_in:120});
  await frame();await frame();
  assert.equal(x.preview.hidden,true);
  assert.equal(x.download.disabled,true);
  x.gallery.reset();
  assert.equal(x.rows.childElementCount,0);
  assert.equal(x.card.classList.contains('hidden'),true);
});

test('signer expiry and URL shape must be exact before exposing a private preview',async()=>{
  for(const expiry of [undefined,0,-1,301,'120',NaN]){
    const x=rig();
    x.enqueue(page([1]));
    await x.gallery.show();
    // Use a direct response promise, not a server request to a different owner.
    const signer = {photo_id:id(1),transfer_version:id(1001),
      url:'https://example.supabase.co/storage/v1/object/sign/fwh-review-private/test?token=fake',
      expires_in:expiry};
    x.enqueue(signer);
    x.rows.children[0].click();
    await frame();await frame();
    assert.equal(x.preview.hidden,true);
    assert.equal(x.download.disabled,true);
  }
});
