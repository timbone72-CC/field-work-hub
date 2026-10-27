const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../dashboard/notifications.js'), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Retain the existing notification refresh owner');
  return source.slice(from, to);
}
const clear = extract('  function clearDisplayed(){', '  function reset(){');
const load = extract('  async function load(){', '  async function mutate(');

function rig(fail = false) {
  const elements = Object.fromEntries([
    'notification-settings', 'notification-list', 'notification-count',
    'notification-push-enable', 'notification-push-disable',
    'notification-org-timezone', 'notification-timezone-save', 'notification-push-status'
  ].map(id => [id, {
    children: ['stale-action'], textContent: 'old server state', disabled: false, value: '',
    replaceChildren(...children) { this.children = children; }
  }]));
  const messages = [], calls = [];
  const types = Array.from({length: 9}, (_, i) => ({type: 'TYPE_' + i}));
  const context = {
    seq: 0, settings: {old: true}, issues: [{id: 'old', current: true}],
    owner: '', organization: '', accessToken: 'current-token',
    currentUser: {id: 'office-user', app_metadata: {organization_id: 'office-org'}},
    el: id => elements[id],
    status: message => messages.push(message),
    current: () => true,
    rpc: async name => {
      calls.push(name);
      if (fail) throw Error('Network unavailable');
      if (name === 'admin_notification_settings')
        return {organization_id: 'office-org', organization_timezone: 'UTC',
          push_ready: false, types, devices: []};
      return {organization_id: 'office-org', alerts: [{id: 'fresh', current: true}]};
    },
    PushDevice: {reconcilePending: async () => {}, supported: () => false},
    renderSettings() { elements['notification-settings'].children = ['fresh-settings']; },
    renderAlerts() {
      elements['notification-list'].children = ['fresh-alerts'];
      elements['notification-count'].textContent = 'fresh count';
    }
  };
  vm.runInNewContext(clear + '\n' + load + '\nthis.runLoad = load;', context);
  return {elements, messages, calls, context};
}

test('failed alert refresh clears stale jobs, actions and enrollment controls before network reply', async () => {
  const ui = rig(true);
  await ui.context.runLoad();
  assert.deepEqual(ui.elements['notification-settings'].children, []);
  assert.deepEqual(ui.elements['notification-list'].children, []);
  assert.equal(ui.elements['notification-count'].textContent, 'Alerts not loaded');
  assert.equal(ui.elements['notification-push-enable'].disabled, true);
  assert.equal(ui.elements['notification-push-disable'].disabled, true);
  assert.equal(ui.elements['notification-timezone-save'].disabled, true);
  assert.equal(ui.elements['notification-org-timezone'].value, '');
  assert.equal(ui.context.settings, null);
  assert.equal(ui.context.issues.length, 0);
  assert.match(ui.messages.at(-1), /Notification status unavailable: Network unavailable/);
  assert.deepEqual(ui.calls, ['admin_notification_settings']);
});

test('successful scoped alert reload restores only newly received server state', async () => {
  const ui = rig();
  await ui.context.runLoad();
  assert.deepEqual(ui.calls, ['admin_notification_settings', 'admin_alert_list']);
  assert.deepEqual(ui.elements['notification-settings'].children, ['fresh-settings']);
  assert.deepEqual(ui.elements['notification-list'].children, ['fresh-alerts']);
  assert.equal(ui.elements['notification-count'].textContent, 'fresh count');
  assert.equal(ui.elements['notification-org-timezone'].value, 'UTC');
  assert.equal(ui.elements['notification-push-enable'].disabled, true);
  assert.equal(ui.elements['notification-push-disable'].disabled, true);
  assert.equal(ui.elements['notification-timezone-save'].disabled, false);
  assert.match(ui.messages.at(-1), /Loaded current server facts/);
});
