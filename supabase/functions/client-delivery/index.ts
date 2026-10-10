// Candidate only. Not deployed: current Team backend has no provider OAuth,
// verified client destination, secure scheduled invocation or real-photo PASS.
// Deployment requires verify_jwt=false PLUS the dedicated worker-secret check.
import {createDeliveryHandler} from './handler.mjs';
Deno.serve(createDeliveryHandler({
 enabled:Deno.env.get('FWH_CLIENT_DELIVERY_ACTIVE')==='true',
 workerSecret:Deno.env.get('FWH_CLIENT_DELIVERY_WORKER_SECRET')??'',
 expectedAccount:Deno.env.get('FWH_CLIENT_DRIVE_ACCOUNT')??'',
 expectedDriveId:Deno.env.get('FWH_CLIENT_SHARED_DRIVE_ID')??'',
 clientId:Deno.env.get('FWH_GOOGLE_OAUTH_CLIENT_ID')??'',
 clientSecret:Deno.env.get('FWH_GOOGLE_OAUTH_CLIENT_SECRET')??'',
 refreshToken:Deno.env.get('FWH_GOOGLE_OAUTH_REFRESH_TOKEN')??'',
 oauthScope:Deno.env.get('FWH_GOOGLE_OAUTH_SCOPE')??'',
 supabaseUrl:Deno.env.get('SUPABASE_URL')??'',
 serviceRoleJwt:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',
}));
