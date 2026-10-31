const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../dashboard/push-device.js'), 'utf8');
const begin = source.indexOf('  async function localEnabled(');
const end = source.indexOf('  function signedOut(){', begin);
assert.ok(begin >= 0 && end > begin, 'Keep the current-device check inside the existing push owner');

async function check(devices, saved, user = {id: 'office-u', app_metadata: {organization_id: 'org-a'}}) {
  const reads = [];
  const ctx = {
    currentUser: user,
    key: (id, org) => id + ':' + org,
    record: async id => { reads.push(id); return saved; }
  };
  vm.runInNewContext(source.slice(begin, end) + '\nthis.checkDevice=localEnabled;', ctx);
  const enabled = await ctx.checkDevice(devices);
  return {enabled, reads};
}

test('another enabled phone cannot enable Disable on the current computer', async () => {
  const result = await check([
    {device_id:'phone-other',enabled:true},
    {device_id:'current-computer',enabled:false}
  ], {device_id:'current-computer',revision:'rev'});
  assert.equal(result.enabled,false);
  assert.deepEqual(result.reads,['office-u:org-a']);
});

test('only a matching enabled device exposes the local Disable action', async () => {
  const result = await check([
    {device_id:'phone-other',enabled:true},
    {device_id:'current-computer',enabled:true}
  ], {device_id:'current-computer',revision:'rev'});
  assert.equal(result.enabled,true);
});

test('pending local revocation can still be retried while the exact server device is enabled', async () => {
  const result = await check([{device_id:'current-computer',enabled:true}],
    {device_id:'current-computer',pending_revoke:true,revision:'rev'});
  assert.equal(result.enabled,true);
});

test('unregistered device, invalid settings list and missing active user fail closed', async () => {
  assert.equal((await check([{device_id:'other',enabled:true}],null)).enabled,false);
  assert.equal((await check(null,{device_id:'current-computer'})).enabled,false);
  const missing = await check([{device_id:'current-computer',enabled:true}],
    {device_id:'current-computer'},null);
  assert.equal(missing.enabled,false);
  assert.deepEqual(missing.reads,[]);
});
