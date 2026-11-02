// Focused PR #40 regression: the browser only offers Send when the server
// explicitly authorizes it; paused delivery gets a truthful visible message.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '../../dashboard/client-release.js'), 'utf8'
);

test('Admin Send remains gated by server authorization', () => {
  assert.match(source,
    /el\('release-send'\)\.disabled=[^;]*pkg\.can_send!==true/);
  assert.match(source,
    /if\(pkg\?\.can_send!==true\|\|dirty\(\)\|\|!confirm/);
});

test('Approved package displays the server delivery-paused explanation', () => {
  assert.match(source, /pkg\?\.status==='APPROVED' && pkg\.send_blocked_reason/);
  assert.match(source, /Package APPROVED\. \$\{pkg\.send_blocked_reason\}/);
});
