// Candidate only. Not deployed: current Team backend has no provider OAuth,
// verified client destination, secure scheduled invocation or real-photo PASS.
// Deployment requires verify_jwt=false PLUS the dedicated worker-secret check.
import {createDeliveryHandler} from './handler.mjs';
Deno.serve(createDeliveryHandler({
 enabled:Deno.env.get('FWH_CLIENT_DELIVERY_ACTIVE')==='true',
 // Independent TEST-only identity/root GET gate; this cannot enable Send.
 testPreflightEnabled:Deno.env.get('FWH_CLIENT_TEST_PREFLIGHT_ENABLED')==='true',
 testEvidenceClass:Deno.env.get('FWH_TEST_EVIDENCE_CLASS')??'',
 testRootFolderId:Deno.env.get('FWH_CLIENT_TEST_ROOT_FOLDER_ID')??'',
 internalDriveId:Deno.env.get('FWH_INTERNAL_SHARED_DRIVE_ID')??'',
 testWorkspaceDomain:Deno.env.get('FWH_TEST_WORKSPACE_DOMAIN')??'',
 workerSecret:Deno.env.get('FWH_CLIENT_DELIVERY_WORKER_SECRET')??'',
 expectedAccount:Deno.env.get('FWH_CLIENT_DRIVE_ACCOUNT')??'',
 expectedDriveId:Deno.env.get('FWH_CLIENT_SHARED_DRIVE_ID')??'',
 clientId:Deno.env.get('FWH_GOOGLE_OAUTH_CLIENT_ID')??'',
 clientSecret:Deno.env.get('FWH_GOOGLE_OAUTH_CLIENT_SECRET')??'',
 refreshToken:Deno.env.get('FWH_GOOGLE_OAUTH_REFRESH_TOKEN')??'',
 oauthScope:Deno.env.get('FWH_GOOGLE_OAUTH_SCOPE')??'',
 supabaseUrl:Deno.env.get('SUPABASE_URL')??'',
 serviceRoleJwt:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',
 // Source-only file continuation needs the separate private AES-GCM key.
 sessionVaultKey:Deno.env.get('FWH_CLIENT_DELIVERY_SESSION_VAULT_KEY')??'',
}));
