// Isolated operator-launcher regression; never calls real Supabase or Google.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const SCRIPT=resolve('ci/phase5d_original_saved_first_photo_once.sh');
function stub(path,text) {
 writeFileSync(path,'#!/usr/bin/env bash\nset -euo pipefail\n'+text+'\n');
 chmodSync(path,0o700);
}
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'fwh-first-photo-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bin=join(root,'bin'),ci=join(root,'ci');
 mkdirSync(bin); mkdirSync(ci);
 const target=join(ci,'phase5d_original_saved_first_photo_once.sh');
 copyFileSync(SCRIPT,target);
 stub(join(ci,'phase5d_saved_photo_migration_preflight.sh'),
  'echo "PASS: isolated preflight"; exit "${MOCK_PREFLIGHT_EXIT:-0}"');
 stub(join(bin,'supabase'),[
  'printf "%s\\n" "$*" >> "$MOCK_CALLS"',
  '[[ "$*" == secrets\\ set* ]] || exit 2',
  // A child reading stdin must not consume any remaining launcher instructions.
  'cat >/dev/null',
  'case "$*" in',
  '  *FWH_CLIENT_TEST_RECOVERY_ENABLED=false*) exit "${MOCK_DISABLE_EXIT:-0}";;',
  '  *FWH_CLIENT_TEST_RECOVERY_ENABLED=true*) exit "${MOCK_ENABLE_EXIT:-0}";;',
  '  *) exit 4;;',
  'esac'
 ].join('\n'));
 stub(join(bin,'curl'),[
  'printf "CURL: %s\\n" "$*" >> "$MOCK_CALLS"',
  'if [[ "${MOCK_CURL_EXIT:-0}" != 0 ]]; then exit "$MOCK_CURL_EXIT"; fi',
  'out=""',
  'while [[ $# -gt 0 ]]; do',
  '  case "$1" in',
  '    --output) out="$2"; shift 2;;',
  '    *) shift;;',
  '  esac',
  'done',
  'printf "%s" \'{"status":"ORIGINAL_TEST_SAVED_FIRST_PHOTO_VERIFIED"}\' > "$out"',
  'printf "%s" "${MOCK_HTTP:-200}"'
 ].join('\n'));
 const calls=join(root,'calls.txt');
 const env={...process.env,PATH:bin+':'+process.env.PATH,
   HOME:root,XDG_STATE_HOME:join(root,'state'),MOCK_CALLS:calls,
   FWH_CLIENT_DELIVERY_WORKER_SECRET:'x'.repeat(64)};
 function run(extra={}) {
  const result=spawnSync('bash',[target],{cwd:root,env:{...env,...extra},
    encoding:'utf8',timeout:10000,input:''});
  assert.equal(result.error,undefined);
  return result;
 }
 function log(){return existsSync(calls)?readFileSync(calls,'utf8'):'';}
 return {root,run,log};
}

test('one POST, verified HTTP, OFF cleanup, and permanent no-retry marker',t=>{
 const f=fixture(t);
 const a=f.run();
 assert.equal(a.status,0,a.stdout+'\n'+a.stderr);
 assert.match(a.stdout,/Calling the original saved-session first-photo continuation ONCE/);
 assert.match(a.stdout,/Curl exit: 0 \| HTTP: 200/);
 assert.match(a.stdout,/PASS: TEST recovery OFF command accepted/);
 assert.equal((f.log().match(/CURL:/g)||[]).length,1);
 assert.equal((f.log().match(/FWH_CLIENT_TEST_RECOVERY_ENABLED=true/g)||[]).length,1);
 assert.equal((f.log().match(/FWH_CLIENT_TEST_RECOVERY_ENABLED=false/g)||[]).length,1);
 assert.doesNotMatch(a.stdout+f.log(),/x{64}/);
 assert.ok(existsSync(join(f.root,'state','field-work-hub','phase5d-original-saved-first-photo-attempted')));
 const b=f.run();
 assert.notEqual(b.status,0);
 assert.match(b.stderr,/Prior first-photo launcher attempt/);
 assert.equal((f.log().match(/CURL:/g)||[]).length,1);
});

test('preflight failure prevents mode changes and all network',t=>{
 const f=fixture(t),a=f.run({MOCK_PREFLIGHT_EXIT:'1'});
 assert.notEqual(a.status,0);
 assert.match(a.stderr,/Canonical Team TEST preflight did not pass/);
 assert.equal(f.log(),'');
});

test('enable failure restores OFF without calling curl',t=>{
 const f=fixture(t),a=f.run({MOCK_ENABLE_EXIT:'7'});
 assert.notEqual(a.status,0);
 assert.match(a.stderr,/TEST recovery enable command failed/);
 assert.match(a.stdout,/PASS: TEST recovery OFF command accepted/);
 assert.doesNotMatch(f.log(),/CURL:/);
});

test('curl timeout stops, does not retry, and restores OFF',t=>{
 const f=fixture(t),a=f.run({MOCK_CURL_EXIT:'28'});
 assert.notEqual(a.status,0);
 assert.match(a.stdout,/Curl exit: 28/);
 assert.match(a.stderr,/NO RETRY/);
 assert.match(a.stdout,/PASS: TEST recovery OFF/);
 assert.equal((f.log().match(/CURL:/g)||[]).length,1);
});

test('HTTP failure and OFF failure fail closed',t=>{
 const f=fixture(t),a=f.run({MOCK_HTTP:'503',MOCK_DISABLE_EXIT:'2'});
 assert.equal(a.status,90);
 assert.match(a.stdout,/HTTP: 503/);
 assert.match(a.stderr,/CRITICAL STOP: TEST recovery OFF command failed/);
 assert.equal((f.log().match(/CURL:/g)||[]).length,1);
});
