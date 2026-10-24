// Candidate only. NOT deployed as the current TEST worker: the confirmed
// client TEST destination is verified but INACTIVE and no real Send gate passed.
// A later authorized rollout needs a private scheduler and dedicated worker
// secret; hosting the current read-only TEST preflight does not enable Send.
import {createDeliveryHandler} from './handler.mjs';
import {selectHostedServiceCredential} from './service-ledger.mjs';
Deno.serve(createDeliveryHandler({
 enabled:Deno.env.get('FWH_CLIENT_DELIVERY_ACTIVE')==='true',
 // Independent TEST-only identity/root GET gate; this cannot enable Send.
 testPreflightEnabled:Deno.env.get('FWH_CLIENT_TEST_PREFLIGHT_ENABLED')==='true',
 // Separate, explicitly enabled original-ID disposable TEST recovery only.
 // This does NOT turn on generic delivery, scheduler, Send or cleanup.
 testRecoveryEnabled:Deno.env.get('FWH_CLIENT_TEST_RECOVERY_ENABLED')==='true',
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
