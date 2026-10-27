const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const JobViewRules = require('../../dashboard/job-workspace.js');
const text = fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
const begin = text.indexOf('  let moving=false;\n  function move(delta) {');
const end = text.indexOf('  function init() {', begin);
assert.ok(begin>0&&end>begin,'Use the existing Phase 6A navigation owner');

function rig({failure=false, changedActor=false}={}) {
  const events = new Map(), calls=[], completions=[], controls = new Map();
  let pendingPageResolve = null, dirty = true, prompts = 0;
  const rows = Array.from({length:25},(_,i)=>({id:'job-'+(i+26)}));
  rows.page={offset:25,total:75};
  const currentUser={id:'user-a',app_metadata:{organization_id:'org-a'}};
  const ctx = {
    state:{size:25}, workOrderRows:rows, selectedRow:rows[0],
    currentUser, accessToken:'token-a', moving:false,
    JobResultNavigation:JobViewRules.JobResultNavigation,
    editSection:{
      addEventListener(type,fn){events.set(type,fn);},
      removeEventListener(type,fn){if(events.get(type)===fn)events.delete(type);}
    },
    el(id){if(!controls.has(id))controls.set(id,{textContent:''});return controls.get(id);},
    choose(id){calls.push('choose:'+id);},
    async load(id){calls.push('load:'+id);},
    guard(action){prompts++; completions.push(Promise.resolve().then(action));},
    async change(offset,keepFilters){
      calls.push('change:'+offset+':'+keepFilters);
      return new Promise(resolve=>{pendingPageResolve=()=>{
        if(failure){resolve(false);return;}
        const next=Array.from({length:25},(_,i)=>({id:'job-'+(i+1)}));
        next.page={offset:0,total:75};
        ctx.workOrderRows=next;
        if(changedActor)ctx.currentUser={id:'user-b',app_metadata:{organization_id:'org-b'}};
        resolve(true);
      };});
    }
  };
  vm.runInNewContext(text.slice(begin,end)+'\nthis.move=move;',ctx);
  return {
    ctx,calls,events,controls,
    move:(delta)=>ctx.move(delta),
    release:()=>{assert.ok(pendingPageResolve,'Page read began');pendingPageResolve();},
    wait:async()=>{await Promise.all(completions);},
    prompts:()=>prompts,
    interact(type='input'){assert.ok(events.get(type),'Tracking editor interaction');events.get(type)();}
  };
}

test('one Discard confirmation is sufficient for the cross-page job',async()=>{
 const x=rig();
 x.move(-1);
 await Promise.resolve();
 assert.equal(x.prompts(),1);
 x.release();await x.wait();
 assert.deepEqual(x.calls,['change:0:true','load:job-25']);
 assert.equal(x.prompts(),1,'Do not prompt twice for the exact same discarded edits');
 assert.equal(x.events.size,0);
});

test('new editor interaction while the page fetches requires a new confirmation',async()=>{
 const x=rig();
 x.move(-1);
 await Promise.resolve();
 x.interact();
 x.release();await x.wait();
 assert.equal(x.prompts(),2,'New edits require a fresh explicit decision');
 assert.deepEqual(x.calls,['change:0:true','load:job-25']);
 assert.equal(x.events.size,0);
});

test('double-click cannot begin overlapping page moves',async()=>{
 const x=rig();
 x.move(-1);await Promise.resolve();
 x.move(-1);
 assert.equal(x.prompts(),1);
 x.release();await x.wait();
 assert.deepEqual(x.calls,['change:0:true','load:job-25']);
});

test('failed page or account switch never opens a different work order',async()=>{
 for(const flags of [{failure:true},{changedActor:true}]){
   const x=rig(flags);
   x.move(-1);await Promise.resolve();
   x.release();await x.wait();
   assert.deepEqual(x.calls,['change:0:true']);
   assert.equal(x.events.size,0);
 }
});
