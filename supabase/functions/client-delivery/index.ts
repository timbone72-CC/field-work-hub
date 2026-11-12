// Phase 5D TEST cutover candidate: all delivery paths default OFF.
// Only the exact FWH TEST project can opt into the server-selected queue
// through a separate backend flag after an approved controlled deployment.
// SQL dispatch, GitHub scheduling and cleanup remain independent OFF gates.
import {createDeliveryHandler} from './handler.mjs';
import {selectHostedServiceCredential} from './service-ledger.mjs';
import {isFwhTestQueueWorkerEnabled} from './queue-wakeup.mjs';
Deno.serve(createDeliveryHandler({
 // Phase 5D: general delivery and legacy recovery stay compiled OFF.
 // Neither the retired one-package TEST path nor the prepared two-slot path
 // may run until a separate exact-identity TEST provider gate.
 enabled:false,
 // Retire only the old hosted TEST route. Historical package/remote IDs and
 // receipts remain in durable DB/provider records, never in new active pins.
 // No caller-selected IDs or environment-controlled package selection.
 pinnedTestEnabled:false,
 pinnedTestPackageId:'',
 pinnedTestDestinationId:'',
 pinnedTestRootFolderId:'',
 // Two distinct Admin-approved disposable FWH TEST packages pinned to the
 // same existing verified destination/root. Literal pins alone authorize
 // NOTHING: the two-slot worker and all other mutating modes stay hard OFF.
 // No request body or environment variable can select a different package.
 twoPackageTestEnabled:false,
 // TEST queue remains OFF without the dedicated backend flag and exact
 // project/evidence pin. Neither GitHub cron nor SQL dispatch is set here.
 queueWorkerEnabled:isFwhTestQueueWorkerEnabled({
  flag:Deno.env.get('FWH_CLIENT_TEST_QUEUE_WORKER_ENABLED')??'',
  projectUrl:Deno.env.get('SUPABASE_URL')??'',
  evidenceClass:Deno.env.get('FWH_TEST_EVIDENCE_CLASS')??''
 }),
 // Independent event transport remains OFF until separately activated in
 // this exact disposable TEST project; SQL ticket consumption also gates it.
 eventWakeEnabled:isFwhTestQueueWorkerEnabled({
  flag:Deno.env.get('FWH_CLIENT_TEST_EVENT_WAKE_ENABLED')??'',
  projectUrl:Deno.env.get('SUPABASE_URL')??'',
  evidenceClass:Deno.env.get('FWH_TEST_EVIDENCE_CLASS')??''
 }),
 twoPackageTestPins:[
  {packageId:'e18463b2-9afe-41b8-9700-721738839b22',destinationId:'06f157eb-230c-44b5-b3d4-a7508110bfd7',rootId:'1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK'},
  {packageId:'e690b8c4-708f-44c2-b6f3-4da01dc07ac4',destinationId:'06f157eb-230c-44b5-b3d4-a7508110bfd7',rootId:'1krqtqQ2geh59IDcyJ9-lCsZ6NnGQmVDK'}
 ],
 // Independent TEST-only identity/root GET gate; this cannot enable Send.
 testPreflightEnabled:Deno.env.get('FWH_CLIENT_TEST_PREFLIGHT_ENABLED')==='true',
 // Separate, explicitly enabled original-ID disposable TEST recovery only.
 // This does NOT turn on generic delivery, scheduler, Send or cleanup.
 testRecoveryEnabled:false,
 testEvidenceClass:Deno.env.get('FWH_TEST_EVIDENCE_CLASS')??'',
 testRootFolderId:Deno.env.get('FWH_CLIENT_TEST_ROOT_FOLDER_ID')??'',
 internalDriveId:Deno.env.get('FWH_INTERNAL_SHARED_DRIVE_ID')??'',
 testWorkspaceDomain:Deno.env.get('FWH_TEST_WORKSPACE_DOMAIN')??'',
 // TEST-only manual release must pin the original approved package and
 // verified company destination; an unconfigured active TEST worker fails closed.
 testReleasePackageId:Deno.env.get('FWH_CLIENT_TEST_RELEASE_PACKAGE_ID')??'',
 testReleaseDestinationId:Deno.env.get('FWH_CLIENT_TEST_RELEASE_DESTINATION_ID')??'',
 workerSecret:Deno.env.get('FWH_CLIENT_DELIVERY_WORKER_SECRET')??'',
 expectedAccount:Deno.env.get('FWH_CLIENT_DRIVE_ACCOUNT')??'',
 expectedDriveId:Deno.env.get('FWH_CLIENT_SHARED_DRIVE_ID')??'',
 clientId:Deno.env.get('FWH_GOOGLE_OAUTH_CLIENT_ID')??'',
 clientSecret:Deno.env.get('FWH_GOOGLE_OAUTH_CLIENT_SECRET')??'',
 refreshToken:Deno.env.get('FWH_GOOGLE_OAUTH_REFRESH_TOKEN')??'',
 oauthScope:Deno.env.get('FWH_GOOGLE_OAUTH_SCOPE')??'',
 supabaseUrl:Deno.env.get('SUPABASE_URL')??'',
 // Prefer Supabase's injected named secret API key, while preserving the
 // existing legacy-only environment when modern keys are not provisioned.
 serviceRoleJwt:selectHostedServiceCredential({
   legacy:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',
   modern:Deno.env.get('SUPABASE_SECRET_KEYS')??''
 }),
 // Source-only file continuation needs the separate private AES-GCM key.
 sessionVaultKey:Deno.env.get('FWH_CLIENT_DELIVERY_SESSION_VAULT_KEY')??'',
}));
