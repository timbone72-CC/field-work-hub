const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../dashboard/notifications.js'), 'utf8');
const begin = source.indexOf('  function sectionHeading(');
const end = source.indexOf('  function renderAlerts(){', begin);
assert.ok(begin >= 0 && end > begin, 'Keep the existing notification preference renderer');

function element(tag = 'div') {
  return {
    tag, children: [], handlers: {}, textContent: '', value: '', checked: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, listener) { this.handlers[name] = listener; }
  };
}

function rig(types) {
  const host = element();
  const writes = [];
  const messages = [];
  const ctx = {
    settings: { types, push_ready: false }, busy: false,
    el: id => { assert.equal(id, 'notification-settings'); return host; },
    document: { createElement: element, createTextNode: text => ({ textContent: text }) },
    LABELS: { ACCEPT_REMINDER: 'Accept reminder', OVERDUE: 'Past due date' },
    mutate: async (name, payload) => writes.push({ name, payload }),
    status: message => messages.push(message),
    crypto: { randomUUID: () => 'fixture-unique-action' },
    Intl
  };
  vm.runInNewContext(source.slice(begin, end), ctx);
  ctx.renderSettings();
  const rows = host.children.slice(1);
  function controls(index) {
    const row = rows[index];
    assert.equal(row.tag, 'div');
    const quietPanel = row.children[4];
    assert.equal(quietPanel.tag, 'details');
    const labels = quietPanel.children[1].children;
    return {
      timezone: labels[0].children[0],
      start: labels[1].children[0],
      end: labels[2].children[0],
      save: row.children[3],
      dashboard: row.children[1].children[0].children[0]
    };
  }
  return { rows, controls, writes, messages };
}

test('saving one alert type cannot copy another type\'s quiet hours', async () => {
  const ui = rig([
    { type: 'ACCEPT_REMINDER', dashboard: true, phone: false, computer: false,
      reminder_minutes: 1440, revision: 'rev-a',
      quiet_timezone: null, quiet_start: null, quiet_end: null },
    { type: 'OVERDUE', dashboard: true, phone: false, computer: false,
      reminder_minutes: 1440, revision: 'rev-b',
      quiet_timezone: 'America/Denver', quiet_start: '22:00:00', quiet_end: '06:00:00' }
  ]);
  const first = ui.controls(0), second = ui.controls(1);
  assert.equal(first.start.value, '');
  assert.equal(first.end.value, '');
  assert.equal(second.timezone.value, 'America/Denver');
  assert.equal(second.start.value, '22:00');
  assert.equal(second.end.value, '06:00');

  first.dashboard.checked = false;
  await first.save.handlers.click();
  await second.save.handlers.click();

  assert.equal(ui.writes.length, 2);
  assert.equal(ui.writes[0].name, 'admin_set_notification_preferences');
  assert.equal(ui.writes[0].payload.p_type, 'ACCEPT_REMINDER');
  assert.equal(ui.writes[0].payload.p_expected_revision, 'rev-a');
  assert.equal(ui.writes[0].payload.p_dashboard, false);
  assert.equal(ui.writes[0].payload.p_quiet_timezone, null);
  assert.equal(ui.writes[0].payload.p_quiet_start, null);
  assert.equal(ui.writes[0].payload.p_quiet_end, null);
  assert.equal(ui.writes[1].payload.p_type, 'OVERDUE');
  assert.equal(ui.writes[1].payload.p_expected_revision, 'rev-b');
  assert.equal(ui.writes[1].payload.p_quiet_timezone, 'America/Denver');
  assert.equal(ui.writes[1].payload.p_quiet_start, '22:00');
  assert.equal(ui.writes[1].payload.p_quiet_end, '06:00');
});

test('invalid quiet-hour edits stop before a preference write', async () => {
  const ui = rig([{type:'OVERDUE',dashboard:true,phone:false,computer:false,
    reminder_minutes:1440,revision:null,quiet_timezone:null,quiet_start:null,quiet_end:null}]);
  const controls = ui.controls(0);
  controls.start.value='20:00';
  await controls.save.handlers.click();
  assert.equal(ui.writes.length,0);
  assert.match(ui.messages[0],/valid IANA time zone and different start\/end times/);

  controls.end.value='06:00';
  controls.timezone.value='not/a-valid-zone';
  await controls.save.handlers.click();
  assert.equal(ui.writes.length,0);

  controls.timezone.value='';
  await controls.save.handlers.click();
  assert.equal(ui.writes.length,0, 'Missing timezone must be rejected locally');

  controls.timezone.value='America/Chicago';
  await controls.save.handlers.click();
  assert.equal(ui.writes.length,1);
  assert.equal(ui.writes[0].payload.p_quiet_timezone,'America/Chicago');
});

test('UTC is an accepted IANA quiet-hours timezone', async () => {
  const ui = rig([{type:'OVERDUE',dashboard:true,phone:false,computer:false,
    reminder_minutes:1440,revision:'rev-utc',quiet_timezone:null,
    quiet_start:null,quiet_end:null}]);
  const controls = ui.controls(0);
  controls.timezone.value='UTC';
  controls.start.value='21:00';
  controls.end.value='07:00';
  await controls.save.handlers.click();
  assert.equal(ui.writes.length,1);
  assert.equal(ui.writes[0].payload.p_expected_revision,'rev-utc');
  assert.equal(ui.writes[0].payload.p_quiet_timezone,'UTC');
  assert.equal(ui.writes[0].payload.p_quiet_start,'21:00');
  assert.equal(ui.writes[0].payload.p_quiet_end,'07:00');
});
