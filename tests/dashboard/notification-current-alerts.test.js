const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../dashboard/notifications.js'), 'utf8');
const start = source.indexOf('  function renderAlerts(){');
const end = source.indexOf('  async function load(', start);
assert.ok(start >= 0 && end > start, 'Keep the existing notification renderer');

function node(tag = 'div') {
  return {
    tag, children: [], textContent: '', disabled: false, className: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    addEventListener() {}
  };
}
function render(issues) {
  const elements = {
    'notification-list': node(),
    'notification-count': node()
  };
  const context = {
    issues,
    el: id => elements[id],
    document: { createElement: node },
    LABELS: { OVERDUE: 'Past due date' },
    JobWorkspace: { choose() { throw Error('Not expected during render'); } },
    mutate() { throw Error('Not expected during render'); },
    crypto: { randomUUID() { throw Error('Not expected during render'); } },
    Date
  };
  const fn = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', context);
  fn();
  return elements;
}

test('resolved and noncurrent issues do not leave an empty alert list without explanation', () => {
  const elements = render([{id:'past',current:false,acknowledged:false,type:'OVERDUE'}]);
  assert.equal(elements['notification-count'].textContent, '0 current unread alerts in this bounded view');
  const children = elements['notification-list'].children;
  assert.equal(children.length, 1);
  assert.equal(children[0].tag, 'p');
  assert.match(children[0].textContent, /No current alerts/);
});

test('current alerts still display while historical noncurrent items are excluded', () => {
  const elements = render([
    {id:'past',current:false,acknowledged:false,type:'OVERDUE'},
    {id:'live',current:true,acknowledged:false,type:'OVERDUE',
      work_order_id:'work',first_at:'2026-10-26T12:00:00Z'}
  ]);
  assert.equal(elements['notification-count'].textContent, '1 current unread alerts in this bounded view');
  const list = elements['notification-list'].children[0];
  assert.equal(list.tag, 'ol');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, 'Past due date');
});
