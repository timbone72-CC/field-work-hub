const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../dashboard/admin-invite.js'),'utf8');
const code=source.replace(/void startSetup\(\);\s*$/, '');
function rig(type, role='SUPERVISOR', marker='bound-invitation', outcome='ACCEPTED') {
  const calls=[], elements=new Map(), scrub=[];
  function element(id) {
    if (!elements.has(id)) elements.set(id,{value:'',textContent:'',className:'',disabled:false,
      classList:{add(){},remove(){}},focus(){},addEventListener(_,fn){this.submit=fn;}});
    return elements.get(id);
  }
  const ctx={URLSearchParams,document:{getElementById:element},
    window:{location:{hash:'#access_token=test-token&type='+type,pathname:'/admin-invite.html',search:''}},
    history:{replaceState(...args){scrub.push(args);}},
    fetch:async(url,opts)=>{calls.push([url,opts]);
      if (url.endsWith('/auth/v1/user') && opts.method!=='PUT') return {ok:true,json:async()=>({
        id:'existing-user',email:'staff@example.invalid',app_metadata:{role,organization_id:'org'},
        user_metadata:{scoped_admin_invitation_id:marker}})};
      if (url.endsWith('/auth/v1/user')) return {ok:true};
      return {ok:true,json:async()=>({status:outcome})};}};
  vm.runInNewContext(code+'\nthis.start=startSetup;',ctx);
  return {start:()=>ctx.start(),el:element,calls,scrub,finish:async()=>{
    element('new-password').value='test-password';
    element('confirm-password').value='test-password';
    await element('password-form').submit({preventDefault(){}});
  }};
}
test('verified recovery uses original Auth identity and existing Supervisor activation, not another invite',async()=>{
  const h=rig('recovery');await h.start();
  assert.equal(h.el('invite-check').textContent,'ACCOUNT RECOVERY VERIFIED');
  assert.equal(h.el('staff-setup-title').textContent,'Set Up Your Supervisor Account');
  assert.equal(h.scrub[0][2],'/admin-invite.html');
  await h.finish();
  assert.equal(h.calls.length,3);
  assert.match(h.calls[2][0],/complete_scoped_supervisor_invitation_activation$/);
  assert.equal(h.calls[2][1].headers.Authorization,'Bearer test-token');
  assert.equal(h.el('invite-check').textContent,'SUPERVISOR ACCOUNT READY');
});
test('ordinary Admin invitation still uses existing Admin activation',async()=>{
  const h=rig('invite','ADMIN');await h.start();await h.finish();
  assert.match(h.calls[2][0],/complete_scoped_admin_invitation_activation$/);
  assert.equal(h.el('invite-check').textContent,'ADMIN ACCOUNT READY');
});
test('unapproved session type, role or missing invitation marker cannot use setup',async()=>{
  for (const h of [rig('magiclink'),rig('recovery','CONTRACTOR'),rig('recovery','SUPERVISOR',null)]) {
    await h.start();await h.finish();
    assert.equal(h.calls.some(c=>c[1].method==='PUT'),false);
    assert.equal(h.calls.some(c=>c[0].includes('/rpc/')),false);
  }
});
test('password recovery never treats a work-disabled outcome as successful activation',async()=>{
  const h=rig('recovery','SUPERVISOR','bound-invitation','WORK_DISABLED');
  await h.start();await h.finish();
  assert.notEqual(h.el('invite-check').textContent,'SUPERVISOR ACCOUNT READY');
  assert.match(h.el('setup-status').textContent,/Work access remains unavailable/);
});
