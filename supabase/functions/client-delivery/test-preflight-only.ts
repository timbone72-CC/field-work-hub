// Temporarily deployed TEST-only entrypoint for existing client-delivery slug.
// This source imports no delivery worker, service-role database client,
// storage reader, photo queue, upload code, or Drive mutating owner.
import {createReadOnlyTestHandler} from './test-preflight-only.mjs';
Deno.serve(createReadOnlyTestHandler({
 deliveryActive:Deno.env.get('FWH_CLIENT_DELIVERY_ACTIVE')==='true',
 testEnabled:Deno.env.get('FWH_CLIENT_TEST_PREFLIGHT_ENABLED')==='true',
 testEvidenceClass:Deno.env.get('FWH_TEST_EVIDENCE_CLASS')??'',
 workerSecret:Deno.env.get('FWH_CLIENT_DELIVERY_WORKER_SECRET')??'',
 expectedEmail:Deno.env.get('FWH_CLIENT_DRIVE_ACCOUNT')??'',
 expectedDriveId:Deno.env.get('FWH_CLIENT_SHARED_DRIVE_ID')??'',
 clientRootId:Deno.env.get('FWH_CLIENT_TEST_ROOT_FOLDER_ID')??'',
 internalDriveId:Deno.env.get('FWH_INTERNAL_SHARED_DRIVE_ID')??'',
 workspaceDomain:Deno.env.get('FWH_TEST_WORKSPACE_DOMAIN')??'',
 clientId:Deno.env.get('FWH_GOOGLE_OAUTH_CLIENT_ID')??'',
 clientSecret:Deno.env.get('FWH_GOOGLE_OAUTH_CLIENT_SECRET')??'',
 refreshToken:Deno.env.get('FWH_GOOGLE_OAUTH_REFRESH_TOKEN')??'',
 oauthScope:Deno.env.get('FWH_GOOGLE_OAUTH_SCOPE')??'',
}));
