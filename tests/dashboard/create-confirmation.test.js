'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../dashboard/app.js'), 'utf8');
const start = source.indexOf("createForm.addEventListener('submit', async (event) => {");
const end = source.indexOf("\n});\n\neditForm.addEventListener('submit'", start);
assert.ok(start >= 0 && end > start, 'Existing Create & Assign handler must remain intact');
const handler = source.slice(start, end + 4);

function createHarness(createResult, refreshFailure = null) {
  let submit = null;
  let createCalls = 0;
  let refreshCalls = 0;
  let resets = 0;
  const notices = [];
  const button = { disabled: false };
  const sandbox = {
    Error,
    createForm: {
      addEventListener: (type, fn) => {
        assert.equal(type, 'submit');
        submit = fn;
      },
      reset: () => { resets++; }
    },
    createButton: button,
    rememberWoNumberMode: { checked: true },
    currentWoNumberMode: () => 'custom',
    setCreateStatus: (message, error) => notices.push({ message, error }),
    createPhotos: { snapshot: () => [], load: () => {} },
    woNumberInput: { value: 'CLIENT-1' },
    propertyAddressInput: { value: 'TEST ADDRESS' },
    workTypeInput: { value: 'Inspection' },
    instructionsInput: { value: 'TEST' },
    dueDateInput: { value: '2026-11-01' },
    assigneeSelect: { value: 'contractor' },
    createWorkOrder: async () => {
      createCalls++;
      if (createResult instanceof Error) throw createResult;
      return typeof createResult === 'function' ? createResult() : createResult;
    },
    refreshWorkOrders: async () => {
      refreshCalls++;
      if (refreshFailure) throw refreshFailure;
    },
    fillWorkTypes: () => {},
    applyWoNumberMode: () => {},
    persistWoNumberModePreference: () => {},
    fillAssigneeSelect: () => {},
    assignableUsers: []
  };
  vm.runInNewContext(handler, sandbox);
  assert.equal(typeof submit, 'function');
  return {
    async run() { await submit({ preventDefault() {} }); },
    get calls() { return { createCalls, refreshCalls, resets }; },
    get messages() { return notices; },
    button
  };
}

test('confirmed create followed by failed list refresh stays confirmed and warns against duplicate submit', async () => {
  const h = createHarness([{ work_order_id: 'server-confirmed', wo_number: 'WO-101' }], new Error('Offline refresh'));
  await h.run();
  assert.deepEqual(h.calls, { createCalls: 1, refreshCalls: 1, resets: 1 });
  assert.equal(h.button.disabled, false);
  assert.match(h.messages.at(-1).message, /Created and assigned WO-101/);
  assert.match(h.messages.at(-1).message, /could not refresh/);
  assert.match(h.messages.at(-1).message, /do not submit this job again/);
  assert.doesNotMatch(h.messages.at(-1).message, /Creation not confirmed|Unable to create/);
});

test('unconfirmed create response preserves draft and tells user to check before retry', async () => {
  for (const outcome of [new Error('Connection lost'), []]) {
    const h = createHarness(outcome);
    await h.run();
    assert.equal(h.calls.createCalls, 1);
    assert.equal(h.calls.refreshCalls, 0);
    assert.equal(h.calls.resets, 0);
    assert.equal(h.button.disabled, false);
    assert.match(h.messages.at(-1).message, /Creation not confirmed/);
    assert.match(h.messages.at(-1).message, /Check Work Orders before submitting again/);
  }
});

test('overlapping submit events are single-flight while a create is pending', async () => {
  let finish;
  const inFlight = new Promise(resolve => { finish = resolve; });
  const h = createHarness(() => inFlight);
  const first = h.run();
  await h.run();
  assert.equal(h.calls.createCalls, 1, 'second submit must not issue another server create');
  assert.equal(h.calls.refreshCalls, 0);
  assert.equal(h.button.disabled, true);
  finish([{ work_order_id: 'server-confirmed', wo_number: 'WO-103' }]);
  await first;
  assert.deepEqual(h.calls, { createCalls: 1, refreshCalls: 1, resets: 1 });
  assert.equal(h.button.disabled, false);
});

test('confirmed create with successful refresh preserves the normal success flow', async () => {
  const h = createHarness([{ work_order_id: 'server-confirmed', wo_number: 'WO-102' }]);
  await h.run();
  assert.deepEqual(h.calls, { createCalls: 1, refreshCalls: 1, resets: 1 });
  assert.equal(h.button.disabled, false);
  assert.match(h.messages.at(-1).message, /Created and assigned WO-102/);
  assert.equal(h.messages.at(-1).error, false);
});
