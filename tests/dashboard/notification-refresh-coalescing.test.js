const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source=fs.readFileSync(require.resolve('../../dashboard/notifications.js'),'utf8');
const clearStart=source.indexOf('  function clearDisplayed(){');
const clearEnd=source.indexOf('  function reset(){',clearStart);
const loadStart=source.indexOf('  async function load(');
const loadEnd=source.indexOf('  async function mutate(',loadStart);
assert.ok(clearStart>=0&&clearEnd>clearStart&&loadStart>clearEnd&&loadEnd>loadStart,
  'Reuse the existing scoped notification loading and clearing owner');

function rig(){
  const calls=[],els={},renders=[];
  for(const id of ['notification-settings','notification-list','notification-count',
    'notification-push-enable','notification-push-disable','notification-org-timezone',
    'notification-timezone-save','notification-push-status']){
    els[id]={children:['previous'],textContent:'previous',disabled:false,value:'',
      replaceChildren(...items){this.children=items;}};
  }
  let releaseFirst=null,firstStarted=false;
  const expectedTypes=Array.from({length:9},(_,i)=>({type:'TYPE'+i}));
  const ctx={
    seq:0,settings:null,issues:[{id:'stale'}],busy:false,fetching:false,fetchingToken:null,
    owner:'',organization:'',accessToken:'token-a',
    currentUser:{id:'user-a',app_metadata:{organization_id:'org-a'}},
    el:id=>els[id],
    status:msg=>{els.status=msg;},
    current:(n,token)=>n===ctx.seq&&token===ctx.accessToken
      &&ctx.currentUser?.id===ctx.owner
      &&ctx.currentUser?.app_metadata?.organization_id===ctx.organization,
    rpc:async (name,_payload,token)=>{
      const org=token==='token-a'?'org-a':'org-b';
      calls.push(name+':'+token);
      if(name==='admin_notification_settings'){
        if(!firstStarted){
          firstStarted=true;
          return await new Promise(resolve=>{releaseFirst=()=>resolve({
            organization_id:org,organization_timezone:'UTC',types:expectedTypes,
            push_ready:false,devices:[]});});
        }
        return {organization_id:org,organization_timezone:'UTC',types:expectedTypes,
          push_ready:false,devices:[]};
      }
      return {organization_id:org,alerts:[{id:'fresh-'+org}]};
    },
    PushDevice:{reconcilePending:async()=>{},localEnabled:async()=>false,supported:()=>false},
    renderSettings:()=>{renders.push('settings');els['notification-settings'].children=['new'];},
    renderAlerts:()=>{renders.push('alerts');els['notification-list'].children=['new'];}
  };
  vm.runInNewContext(source.slice(clearStart,clearEnd)+'\n'+
    source.slice(loadStart,loadEnd)+'\nthis.testLoad=load;',ctx);
  return {ctx,calls,els,renders,releaseFirst:()=>releaseFirst()};
}

test('simultaneous same-session automatic refreshes coalesce instead of clearing twice',async()=>{
  const x=rig(),first=x.ctx.testLoad();
  assert.equal(x.ctx.fetching,true);
  assert.deepEqual(x.calls,['admin_notification_settings:token-a']);
  const second=x.ctx.testLoad();
  await second;
  assert.deepEqual(x.calls,['admin_notification_settings:token-a']);
  x.releaseFirst();await first;
  assert.deepEqual(x.calls,[
    'admin_notification_settings:token-a','admin_alert_list:token-a']);
  assert.deepEqual(x.renders,['settings','alerts']);
  assert.equal(x.ctx.fetching,false);
  assert.equal(x.els['notification-count'].textContent,'Alerts not loaded',
    'Synthetic rig does not manufacture a rendered count');
});

test('explicit refresh supersedes an earlier incomplete read without letting old facts paint',async()=>{
  const x=rig(),first=x.ctx.testLoad();
  const forced=x.ctx.testLoad(true);
  await forced;
  assert.deepEqual(x.renders,['settings','alerts']);
  assert.equal(x.ctx.fetching,false);
  x.releaseFirst();await first;
  assert.deepEqual(x.renders,['settings','alerts']);
  assert.deepEqual(x.calls,[
    'admin_notification_settings:token-a','admin_notification_settings:token-a',
    'admin_alert_list:token-a']);
});

test('a new office session can load without waiting for stale previous actor response',async()=>{
  const x=rig(),old=x.ctx.testLoad();
  x.ctx.accessToken='token-b';
  x.ctx.currentUser={id:'user-b',app_metadata:{organization_id:'org-b'}};
  await x.ctx.testLoad();
  assert.equal(x.ctx.organization,'org-b');
  assert.equal(x.ctx.settings.organization_id,'org-b');
  assert.equal(x.ctx.issues[0].id,'fresh-org-b');
  x.releaseFirst();await old;
  assert.equal(x.ctx.organization,'org-b');
  assert.deepEqual(x.renders,['settings','alerts']);
});
