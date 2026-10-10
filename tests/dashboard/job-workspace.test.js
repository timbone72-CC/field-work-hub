const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rules = require('../../dashboard/job-workspace.js');
const app = fs.readFileSync(require.resolve('../../dashboard/app.js'), 'utf8');

test('job reads are bounded and presentation filters cannot supply columns or operators', () => {
  const query = rules.parameters({ size: 1000, sort: 'organization_id.asc', status: 'eq.ADMIN',
    searchField: 'organization_id', search: 'A*B_%', offset: 25 });
  assert.equal(query.get('limit'), '25'); assert.equal(query.get('offset'), '25');
  assert.equal(query.get('order'), 'created_at.desc.nullslast,id.asc');
  assert.equal(query.get('property_address'), 'ilike.*A\\*B\\_\\%*');
  assert.equal(query.has('organization_id'), false); assert.equal(query.has('field_status'), false);
  assert.equal(rules.parameters({ size: 50 }).get('limit'), '50');
});
test('stored job-view preferences exclude searches, identities and payloads', () => {
  assert.deepEqual(rules.normalize({ size: 50, status: 'ASSIGNED', sort: 'due_date.asc',
    search: 'Private address', access_token: 'private', instructions: 'Private work', id: 'private' }),
  { size: 50, status: 'ASSIGNED', sort: 'due_date.asc' });
});
test('unknown count stays unknown rather than inventing a total', () => {
  assert.equal(rules.total('0-24/1000'), 1000); assert.equal(rules.total('*/0'), 0);
  assert.equal(rules.total('0-24/*'), null); assert.equal(rules.total(null), null);
});
test('empty and partial authorized pages do not require synthetic control jobs; foreign rows fail closed', () => {
  const ctx = vm.createContext({});
  vm.runInContext(app.match(/function verifyAdminRls[\s\S]*?\n}\n/)[0], ctx);
  const verify = ctx.verifyAdminRls;
  assert.doesNotThrow(() => verify([], 'org-one'));
  assert.doesNotThrow(() => verify([{ organization_id: 'org-one', wo_number: 'WO-25' }], 'org-one'));
  assert.throws(() => verify([{ organization_id: 'org-two' }], 'org-one'), /another organization/);
  assert.throws(() => verify([{ organization_id: 'org-one', wo_number: 'TEST-OTHER-ORG-CONTROL' }], 'org-one'), /control/);
  assert.throws(() => verify({}, 'org-one'), /Unexpected/);
});
