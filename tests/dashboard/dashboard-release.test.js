const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../dashboard/dashboard-release.js'), 'utf8');
const installed = 'a'.repeat(40), latest = 'b'.repeat(40);
function rig() {
  const calls = [], timers = new Map(), fields = {}, navigations = [];
  let timerId = 0, dirty = false, available = latest, failed = false, confirm = true;
  for (const id of ['status','reload','help']) fields['dashboard-release-'+id] = {
    hidden: true, textContent: '', addEventListener(event, cb) { this[event] = cb; }
  };
  const ctx = vm.createContext({
    URL, Date, AbortSignal,
    navigator: {onLine:true},
    document: {hidden:false, baseURI:'https://example.invalid/field-work-hub/',
      querySelector:()=>({content:installed}), getElementById:id=>fields[id],
      addEventListener(event,cb){this[event]=cb;}},
    window: {location:{origin:'https://example.invalid',href:'https://example.invalid/field-work-hub/?alert=existing',
        replace(url){navigations.push(url);}},
      addEventListener(event,cb){this[event]=cb;},confirm:()=>confirm},
    JobWorkspace:{dirty:()=>dirty}, CreateJobDrafts:{dirty:()=>false,busy:()=>false},
    adminWritesPending:0, ownerInvitePending:null,
    setTimeout(cb,delay){timers.set(++timerId,{cb,delay});return timerId;},
    clearTimeout(id){timers.delete(id);},
    async fetch(url,options){calls.push({url,options});if(failed)throw Error('offline');
      return {ok:true,json:async()=>({revision:available})};}
  });
  vm.runInContext(source,ctx);
  return {ctx,calls,fields,navigations,timers,
    setDirty:v=>dirty=v,setAvailable:v=>available=v,setFailed:v=>failed=v,setConfirm:v=>confirm=v,
    async tick(){const next=timers.values().next().value;assert.ok(next);await next.cb();},
    click(){fields['dashboard-release-reload'].click();}};
}
test('detects a published update without automatic reload or credentials',async()=>{
  const h=rig();await h.tick();
  assert.equal(h.fields['dashboard-release-reload'].hidden,false);
  assert.match(h.fields['dashboard-release-status'].textContent,/Update available/);
  assert.equal(h.calls[0].options.cache,'no-store');
  assert.equal(h.calls[0].options.credentials,'omit');
  assert.match(h.calls[0].url,/dashboard-release\.json\?check=/);
  assert.equal(h.navigations.length,0);
  h.setDirty(true);h.click();assert.equal(h.navigations.length,0);
  assert.match(h.fields['dashboard-release-status'].textContent,/unsaved job changes/);
  h.setDirty(false);h.ctx.adminWritesPending=1;h.click();assert.equal(h.navigations.length,0);
  h.ctx.adminWritesPending=0;h.ctx.ownerInvitePending={};h.click();assert.equal(h.navigations.length,0);
  h.ctx.ownerInvitePending=null;h.setConfirm(false);h.click();assert.equal(h.navigations.length,0);
  h.setConfirm(true);h.click();
  const url=new URL(h.navigations[0]);assert.equal(url.searchParams.get('fwh_build'),latest);
  assert.equal(url.searchParams.get('alert'),'existing');assert.ok(url.searchParams.get('fwh_reload'));
});
test('does not offer an update for identical or invalid release and retains current page on failure',async()=>{
  const h=rig();h.setAvailable(installed);await h.tick();
  assert.equal(h.fields['dashboard-release-reload'].hidden,true);
  assert.match(h.fields['dashboard-release-status'].textContent,/Up to date/);
  h.setAvailable('invalid');await h.tick();
  assert.equal(h.fields['dashboard-release-reload'].hidden,true);
  assert.match(h.fields['dashboard-release-status'].textContent,/unavailable/);
  h.setAvailable(latest);await h.tick();h.setFailed(true);await h.tick();
  assert.equal(h.fields['dashboard-release-reload'].hidden,false);
  assert.equal(h.navigations.length,0);
  h.ctx.navigator.onLine=false;h.ctx.window.offline();h.click();assert.equal(h.navigations.length,0);
});
