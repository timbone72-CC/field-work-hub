// Hermetic regression for the existing read-only Phase 5D TEST migration preflight.
// Uses isolated fake git/gh/supabase executables; never contacts a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const TARGET=resolve('ci/phase5d_team_migration_preflight.sh');
const REF='vyocaujuwrivoqynvitm';
const BRANCH='feat/phase-5-6-dashboard-workflow';
const HEAD='disposable-verified-head';
function stub(path,text){
 writeFileSync(path,'#!/usr/bin/env bash\nset -euo pipefail\n'+text+'\n');
 chmodSync(path,0o700);
}
test('read-only exact-head Team dry-run accepts zero pending; all uncertain and stale cases fail closed',t=>{
 const tmp=mkdtempSync(join(tmpdir(),'fwh-phase5d-migration-test-'));
 t.after(()=>rmSync(tmp,{recursive:true,force:true}));
 const bin=join(tmp,'bin'),dir=join(tmp,'source');
 mkdirSync(bin);mkdirSync(join(dir,'supabase','migrations'),{recursive:true});
 mkdirSync(join(dir,'supabase','.temp'));
 writeFileSync(join(dir,'AGENTS.md'),'fixture\n');
 writeFileSync(join(dir,'supabase','config.toml'),'fixture\n');
 const expected='20261020020000_phase_5_delivery_dispatch_singleflight.sql';
 for(let i=0;i<107;i++)writeFileSync(join(dir,'supabase','migrations',
   'fixture_'+String(i).padStart(3,'0')+'.sql'),'-- disposable\n');
 writeFileSync(join(dir,'supabase','migrations',expected),'-- disposable\n');
 writeFileSync(join(dir,'supabase','.temp','project-ref'),REF+'\n');
 stub(join(bin,'git'),`case "$*" in
  "branch --show-current") printf '%s\\n' "$FWH_STUB_BRANCH";;
  "status --porcelain") :;;
  "remote get-url origin") printf '%s\\n' "$FWH_STUB_REMOTE";;
  "rev-parse HEAD") printf '%s\\n' "$FWH_STUB_HEAD";;
  *) exit 3;;
 esac`);
 stub(join(bin,'gh'),`case "$*" in
  "api repos/timbone72-CC/field-work-hub/pulls/40 --jq .head.sha")
    printf '%s\\n' "$FWH_STUB_HEAD";;
  "api repos/timbone72-CC/field-work-hub/pulls/40 --jq .draft")
    printf '%s\\n' "true";;
  *) exit 3;;
 esac`);
 stub(join(bin,'supabase'),`[[ "$*" == 'db push --dry-run --linked' ]] || exit 3
 printf '%s\\n' "$FWH_STUB_DRYRUN"
 exit "$FWH_STUB_EXIT"`);
 const base={
   ...process.env,PATH:bin+':'+process.env.PATH,
   FWH_STUB_BRANCH:BRANCH,
   FWH_STUB_REMOTE:'https://github.com/timbone72-CC/field-work-hub.git',
   FWH_STUB_HEAD:HEAD,
   FWH_STUB_DRYRUN:'DRY RUN: migrations will not be applied.\\nRemote database is up to date.',
   FWH_STUB_EXIT:'0'
 };
 function execute(extra={}){
   const r=spawnSync('bash',[TARGET],{cwd:dir,env:{...base,...extra},
     encoding:'utf8',timeout:10000});
   assert.equal(r.error,undefined);
   return r;
 }
 let r=execute();
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/zero pending migrations/);
 assert.match(r.stdout,/NO MIGRATIONS APPLIED/);
 const stops=[
   {env:{FWH_STUB_DRYRUN:'DRY RUN: migrations will not be applied.\\n20261021000000_unexpected_pending.sql'},code:/STOP: Unexpected pending/},
   {env:{FWH_STUB_DRYRUN:'Remote database is up to date.\\n20261021000000_unexpected_pending.sql'},code:/STOP: Unexpected pending/},
   {env:{FWH_STUB_DRYRUN:'DRY RUN: migrations will not be applied.'},code:/STOP: Dry-run did not positively confirm/},
   {env:{FWH_STUB_DRYRUN:'Remote database is up to date.',FWH_STUB_EXIT:'1'},code:/STOP: Supabase canonical dry-run failed/},
   {env:{FWH_STUB_BRANCH:'main'},code:/STOP: Not on PR #40/},
   {env:{FWH_STUB_HEAD:'another-head',FWH_STUB_REMOTE:'invalid-example.net'},code:/STOP: Remote is not/}
 ];
 for(const {env,code} of stops){
   r=execute(env);
   assert.notEqual(r.status,0);
   assert.match(r.stderr,code);
   assert.doesNotMatch(r.stdout,/NO MIGRATIONS APPLIED/);
 }
 writeFileSync(join(dir,'supabase','.temp','project-ref'),'different-project\n');
 r=execute();assert.match(r.stderr,/STOP: Linked Supabase project/);
 writeFileSync(join(dir,'supabase','.temp','project-ref'),REF+'\n');
 unlinkSync(join(dir,'supabase','migrations','fixture_000.sql'));
 r=execute();assert.match(r.stderr,/STOP: Canonical source migration count changed/);
});
