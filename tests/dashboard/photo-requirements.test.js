const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../../dashboard/photo-requirements.js');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
function configuration(total, counts) {
  return { schema: 1, revision: id(1), total: { enabled: total !== null, minimum: total || 0 }, items: counts.map((minimum, n) => ({ id: id(n + 2), label: `Item ${n}`, enabled: true, minimum, instruction: '', stage: 'NONE', framing: 'NORMAL', order: n })) };
}
test('26 specified plus 30 total requires four additional, while 40 specified overrides a smaller total', () => {
  assert.deepEqual(rules.validate(configuration(30, [5, 5, 8, 8])), { specified: 26, additional: 4, minimum: 30 });
  assert.deepEqual(rules.validate(configuration(30, [10, 10, 10, 10])), { specified: 40, additional: 0, minimum: 40 });
});
test('all controls can be optional without destroying configured rows', () => {
  const c = configuration(30, [5, 8]); c.total.enabled = false; c.items.forEach(i => i.enabled = false);
  assert.equal(rules.validate(c).minimum, 0); assert.equal(c.items.length, 2);
});
test('malformed counts, duplicate labels/IDs and unsupported fields fail closed', () => {
  for (const mutate of [c => c.items[0].minimum = 1.5, c => c.items[0].minimum = -1, c => c.items[0].minimum = '5',
    c => c.items[0].minimum = 0, c => c.items[1].id = c.items[0].id, c => c.items[1].label = c.items[0].label.toUpperCase(),
    c => c.items[0].label = 'Extra', c => c.schema = 2, c => c.walkingRequired = true]) {
    const c = configuration(30, [5, 8]); mutate(c); assert.throws(() => rules.validate(c));
  }
});
test('display order and stage/framing do not add another counting rule', () => {
  const c = configuration(null, [4, 4]); c.items[0].stage = 'DURING'; c.items[0].framing = 'WIDE'; c.items[0].order = 9;
  assert.equal(rules.validate(c).minimum, 8);
});
