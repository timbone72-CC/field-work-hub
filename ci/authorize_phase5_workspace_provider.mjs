// One-time operator-only FWH Phase 5D Google Workspace OAuth bootstrap.
// Local loopback callback: never deployed to the dashboard, Android or Supabase.
// Client JSON and resulting refresh credential stay outside this public repository.
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,mkdir,open,chmod,lstat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {setDefaultResultOrder} from 'node:dns';
import {setDefaultAutoSelectFamily} from 'node:net';
import {pathToFileURL} from 'node:url';
import {createWorkspaceTokenProvider} from '../supabase/functions/client-delivery/workspace-oauth.mjs';
import {createDriveClient} from '../supabase/functions/client-delivery/drive-client.mjs';

export const REDIRECT_URI='http://127.0.0.1:8765/oauth2/callback';
const SCOPE='https://www.googleapis.com/auth/drive';
const TOKEN='https://oauth2.googleapis.com/token';
const ID=/^[A-Za-z0-9_-]{10,160}$/;
const EMAIL=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export class WorkspaceBootstrapBlocked extends Error {
  constructor(code){super(code);this.name='WorkspaceBootstrapBlocked';this.code=code;}
}
const CALLBACK_ERROR_CODES=new Set([
  'GOOGLE_OAUTH_CONSENT_REQUIRED','TOKEN_EXCHANGE_UNAVAILABLE',
  'INVALID_TOKEN_RESPONSE','OFFLINE_DRIVE_CONSENT_NOT_GRANTED',
  'GOOGLE_ACCESS_TOKEN_INVALID','WORKSPACE_ACCOUNT_NOT_VERIFIED',
  'TEST_DESTINATION_NOT_VERIFIED','OAUTH_REFRESH_VALIDATION_FAILED',
  'WORKSPACE_OAUTH_UNCERTAIN','TOKEN_ENDPOINT_DNS_FAILURE',
  'TOKEN_ENDPOINT_TIMEOUT','TOKEN_ENDPOINT_CONNECTION_FAILURE',
  'TOKEN_ENDPOINT_TLS_FAILURE','TOKEN_ENDPOINT_UNEXPECTED_RESPONSE'
]);
const fail=code=>{throw new WorkspaceBootstrapBlocked(code);};
// Node 20's default Happy Eyeballs family switching can time out on operator
// networks with broken IPv6. Only the one-time, standalone CLI calls this.
// Keep regular trusted server fetch, TLS checking and Drive identity owners
// unchanged; do not force a provider-wide production transport preference.
export function preferIPv4ForLocalWorkspaceBootstrap(){
  setDefaultResultOrder('ipv4first');
  setDefaultAutoSelectFamily(false);
}
// Map only stable transport codes; never print a Google response, request or exception.
// The same transport classification is used for the credential-free preflight
// and the real one-time authorization-code exchange.
export function tokenTransportCode(error){
  const code=error?.cause?.code??error?.code;
  if(['ENOTFOUND','EAI_AGAIN'].includes(code))return 'TOKEN_ENDPOINT_DNS_FAILURE';
  if(['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(code)
    ||error?.name==='TimeoutError')return 'TOKEN_ENDPOINT_TIMEOUT';
  if(['ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','ECONNRESET',
    'UND_ERR_SOCKET'].includes(code))return 'TOKEN_ENDPOINT_CONNECTION_FAILURE';
  if(['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT','CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code))return 'TOKEN_ENDPOINT_TLS_FAILURE';
  return 'TOKEN_EXCHANGE_UNAVAILABLE';
}
// Check the exact HTTPS POST transport without submitting any credential,
// Google account identity, user code, refresh token or local folder ID.
// Google's invalid_grant response is EXPECTED; any HTTP response proves a
// reachable token service. Never confuse that expected 400 with OAuth consent.
export async function checkTokenEndpoint({fetcher=fetch}={}){
  let response;
  try{
    response=await fetcher(TOKEN,{method:'POST',redirect:'error',
      headers:{'Content-Type':'application/x-www-form-urlencoded',
        Accept:'application/json'},
      body:'grant_type=fwh_connectivity_probe',
      signal:AbortSignal.timeout(12000)});
  }catch(error){fail(tokenTransportCode(error));}
  try{await response.body?.cancel();}catch{}
  if(!Number.isInteger(response.status)||response.status<400||response.status>=500)
    fail('TOKEN_ENDPOINT_UNEXPECTED_RESPONSE');
  return true;
}
const b64=x=>Buffer.from(x).toString('base64url');

export function validateBootstrapConfiguration(json,env){
  if(env.FWH_TEST_EVIDENCE_CLASS!=='DISPOSABLE_FWH_TEST_ONLY')
    fail('TEST_ONLY_EVIDENCE_REQUIRED');
  const web=json?.web;
  if(!web||typeof web!=='object'||Array.isArray(web)
    ||web.project_id!=='field-work-hub'
    ||!/^[0-9]+-[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(web.client_id??'')
    ||typeof web.client_secret!=='string'||web.client_secret.length<16
    ||web.auth_uri!=='https://accounts.google.com/o/oauth2/auth'
    ||web.token_uri!==TOKEN)fail('EXACT_FWH_WEB_CLIENT_REQUIRED');
  const email=env.FWH_TEST_WORKSPACE_EMAIL?.trim().toLowerCase();
  const domain=env.FWH_TEST_WORKSPACE_DOMAIN?.trim().toLowerCase();
  const internal=env.FWH_TEST_INTERNAL_SHARED_DRIVE_ID;
  const clientDrive=env.FWH_TEST_CLIENT_SHARED_DRIVE_ID;
  const root=env.FWH_TEST_CLIENT_ROOT_FOLDER_ID;
  if(!EMAIL.test(email??'')||!EMAIL.test('x@'+domain)
    ||email.split('@')[1]!==domain)fail('EXACT_WORKSPACE_ACCOUNT_REQUIRED');
  if(!ID.test(internal??'')||!ID.test(clientDrive??'')||!ID.test(root??'')
    ||new Set([internal,clientDrive,root]).size!==3)
    fail('DISTINCT_TEST_CLIENT_DESTINATION_REQUIRED');
  if(env.FWH_TEST_WORKSPACE_SCOPE!==SCOPE)fail('EXACT_DRIVE_SCOPE_REQUIRED');
  const output=env.FWH_TEST_CREDENTIALS_OUT;
  if(typeof output!=='string'||!output.startsWith(homedir()+'/.config/field-work-hub/')
    ||output.includes('\0')||dirname(output)!==homedir()+'/.config/field-work-hub'
    ||!/^[A-Za-z0-9_-]+\.json$/.test(output.split('/').at(-1)))
    fail('PRIVATE_OUTPUT_PATH_REQUIRED');
  return {email,domain,internal,clientDrive,root,output,
    clientId:web.client_id,clientSecret:web.client_secret};
}

export function makeAuthorizationUrl({clientId,email,state,verifier}){
  if(!/^[0-9]+-[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId??'')
    ||!EMAIL.test(email??'')||!/^[-_A-Za-z0-9]{32,128}$/.test(state??'')
    ||!/^[-_A-Za-z0-9]{43,128}$/.test(verifier??''))fail('INVALID_OAUTH_REQUEST');
  const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [k,v] of Object.entries({
    client_id:clientId,redirect_uri:REDIRECT_URI,response_type:'code',
    scope:SCOPE,access_type:'offline',prompt:'consent',login_hint:email,
    state,code_challenge_method:'S256',
    code_challenge:b64(createHash('sha256').update(verifier).digest())
  }))u.searchParams.set(k,v);
  return u.toString();
}

export async function exchangeAndVerify({code,verifier,config,fetcher=fetch}){
  if(typeof code!=='string'||code.length<8||code.length>4096
    ||!/^[-_A-Za-z0-9]{43,128}$/.test(verifier??''))fail('INVALID_AUTHORIZATION_CODE');
  const body=new URLSearchParams({code,client_id:config.clientId,
    client_secret:config.clientSecret,redirect_uri:REDIRECT_URI,
    grant_type:'authorization_code',code_verifier:verifier});
  let response;
  try{response=await fetcher(TOKEN,{method:'POST',redirect:'error',
    headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
    body:body.toString(),signal:AbortSignal.timeout(20000)});}catch(error){fail(tokenTransportCode(error));}
  if(!response.ok){await response.body?.cancel().catch(()=>{});fail('GOOGLE_OAUTH_CONSENT_REQUIRED');}
  let token;
  try{const raw=await response.text();if(raw.length>12000)throw Error();token=JSON.parse(raw);}
  catch{fail('INVALID_TOKEN_RESPONSE');}
  if(token.token_type!=='Bearer'||typeof token.access_token!=='string'
    ||token.access_token.length<20||typeof token.refresh_token!=='string'
    ||token.refresh_token.length<16||token.refresh_token.length>8192
    ||typeof token.expires_in!=='number'||token.expires_in<60
    ||typeof token.scope!=='string'||!token.scope.split(' ').includes(SCOPE))
    fail('OFFLINE_DRIVE_CONSENT_NOT_GRANTED');
  // Each boundary reports a fixed, non-sensitive checkpoint code.
  // Never log Google response bodies, token details or provider URLs.
  let drive;
  try{drive=createDriveClient({accessToken:token.access_token,fetcher});}
  catch{fail('GOOGLE_ACCESS_TOKEN_INVALID');}
  try{await drive.verifyProviderIdentity(config.email);}
  catch{fail('WORKSPACE_ACCOUNT_NOT_VERIFIED');}
  try{
    const folder=await drive.verifyDestination({
      folderId:config.root,expectedDriveId:config.clientDrive
    });
    if(folder.id!==config.root||folder.drive_id!==config.clientDrive)
      fail('TEST_DESTINATION_NOT_VERIFIED');
  }catch{fail('TEST_DESTINATION_NOT_VERIFIED');}
  try{
    const refresh=createWorkspaceTokenProvider({clientId:config.clientId,
      clientSecret:config.clientSecret,refreshToken:token.refresh_token,
      requiredScope:SCOPE,fetcher});
    await refresh();
  }catch{fail('OAUTH_REFRESH_VALIDATION_FAILED');}
  return {
    FWH_TEST_EVIDENCE_CLASS:'DISPOSABLE_FWH_TEST_ONLY',
    FWH_TEST_WORKSPACE_EMAIL:config.email,
    FWH_TEST_WORKSPACE_DOMAIN:config.domain,
    FWH_TEST_INTERNAL_SHARED_DRIVE_ID:config.internal,
    FWH_TEST_CLIENT_SHARED_DRIVE_ID:config.clientDrive,
    FWH_TEST_CLIENT_ROOT_FOLDER_ID:config.root,
    FWH_TEST_WORKSPACE_CLIENT_ID:config.clientId,
    FWH_TEST_WORKSPACE_CLIENT_SECRET:config.clientSecret,
    FWH_TEST_WORKSPACE_REFRESH_TOKEN:token.refresh_token,
    FWH_TEST_WORKSPACE_SCOPE:SCOPE
  };
}

export async function savePrivateReceipt(destination,values){
  const dir=dirname(destination);
  await mkdir(dir,{recursive:true,mode:0o700});
  await chmod(dir,0o700);
  // 'wx' refuses overwrite and symlink follow; no data is written to Git.
  const f=await open(destination,'wx',0o600);
  try{await f.writeFile(JSON.stringify(values)+'\n','utf8');await f.sync();}
  finally{await f.close();}
}

export async function authorizeWorkspace({credentialsPath,env=process.env,
  fetcher=fetch,logger=console.log,save=savePrivateReceipt,timeoutMs=300000}={}){
  if(typeof credentialsPath!=='string'||!credentialsPath)
    fail('PRIVATE_CLIENT_JSON_PATH_REQUIRED');
  let json;
  try{const raw=await readFile(credentialsPath,'utf8');
    if(raw.length>16384)throw Error();json=JSON.parse(raw);
  }catch{fail('WEB_CLIENT_JSON_NOT_READABLE');}
  const config=validateBootstrapConfiguration(json,env);
  try{await lstat(config.output);fail('PRIVATE_OUTPUT_FILE_ALREADY_EXISTS');}
  catch(e){if(e?.code!=='ENOENT')fail('PRIVATE_OUTPUT_FILE_ALREADY_EXISTS');}
  // Do not waste single-use consent codes when this laptop cannot reach Google.
  await checkTokenEndpoint({fetcher});
  const state=b64(randomBytes(32)),verifier=b64(randomBytes(32));
  const url=makeAuthorizationUrl({clientId:config.clientId,email:config.email,
    state,verifier});
  let server,timer;
  try{
    return await new Promise((resolveDone,reject)=>{
      let accepted=false,finished=false;
      const done=(error,ok=false)=>{
        if(finished)return;
        finished=true;
        if(error)reject(error);else resolveDone(ok);
      };
      server=createServer(async(req,res)=>{
        const reply=(status,message)=>{res.writeHead(status,{
          'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store',
          'Referrer-Policy':'no-referrer'
        });res.end(message);};
        if(req.method!=='GET')return reply(405,'Method not allowed');
        let parsed;
        try{parsed=new URL(req.url,REDIRECT_URI);}
        catch{return reply(400,'Invalid callback');}
        if(parsed.pathname!=='/oauth2/callback')return reply(404,'Not found');
        if(parsed.searchParams.get('state')!==state)
          return reply(403,'Invalid authorization state');
        if(accepted)return reply(409,'Callback already handled');
        accepted=true;
        const code=parsed.searchParams.get('code');
        if(parsed.searchParams.has('error')||!code){
          reply(403,'Google consent was not completed');
          return done(new WorkspaceBootstrapBlocked('GOOGLE_OAUTH_CONSENT_REQUIRED'));
        }
        try{
          const values=await exchangeAndVerify({code,verifier,config,fetcher});
          await save(config.output,values);
          reply(200,'Field Work Hub TEST Workspace connection verified. You can close this tab.');
          done(null,true);
        }catch(error){
          const code=error instanceof WorkspaceBootstrapBlocked
            && CALLBACK_ERROR_CODES.has(error.code)
            ? error.code:'WORKSPACE_OAUTH_UNCERTAIN';
          reply(403,'Field Work Hub TEST authorization blocked: '+code
            +'. No connection saved. Return only this code to support.');
          done(new WorkspaceBootstrapBlocked(code));
        }
      });
      server.once('error',()=>done(new WorkspaceBootstrapBlocked('LOCAL_CALLBACK_PORT_UNAVAILABLE')));
      server.listen(8765,'127.0.0.1',()=>{
        logger('Open this link using your Workspace Chrome profile:');
        logger(url);
        logger('Waiting for one local Google authorization. No token or secret will print.');
      });
      timer=setTimeout(()=>done(new WorkspaceBootstrapBlocked('GOOGLE_AUTHORIZATION_TIMED_OUT')),timeoutMs);
    });
  }finally{clearTimeout(timer);server?.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  preferIPv4ForLocalWorkspaceBootstrap();
  authorizeWorkspace({credentialsPath:process.argv[2]}).then(()=>{
    process.stdout.write('PASS: Workspace identity and separate writable TEST Drive verified. Protected credential file saved; no Send.\n');
  }).catch(error=>{
    const allow=new Set(['TEST_ONLY_EVIDENCE_REQUIRED','EXACT_FWH_WEB_CLIENT_REQUIRED',
      'EXACT_WORKSPACE_ACCOUNT_REQUIRED','DISTINCT_TEST_CLIENT_DESTINATION_REQUIRED',
      'EXACT_DRIVE_SCOPE_REQUIRED','PRIVATE_OUTPUT_PATH_REQUIRED',
      'PRIVATE_CLIENT_JSON_PATH_REQUIRED','WEB_CLIENT_JSON_NOT_READABLE',
      'PRIVATE_OUTPUT_FILE_ALREADY_EXISTS','INVALID_OAUTH_REQUEST',
      'LOCAL_CALLBACK_PORT_UNAVAILABLE','GOOGLE_AUTHORIZATION_TIMED_OUT',
      'GOOGLE_OAUTH_CONSENT_REQUIRED','TOKEN_EXCHANGE_UNAVAILABLE',
      'INVALID_TOKEN_RESPONSE','OFFLINE_DRIVE_CONSENT_NOT_GRANTED',
      'GOOGLE_ACCESS_TOKEN_INVALID','WORKSPACE_ACCOUNT_NOT_VERIFIED',
      'TEST_DESTINATION_NOT_VERIFIED','OAUTH_REFRESH_VALIDATION_FAILED',
      'WORKSPACE_OAUTH_UNCERTAIN','TOKEN_ENDPOINT_DNS_FAILURE',
      'TOKEN_ENDPOINT_TIMEOUT','TOKEN_ENDPOINT_CONNECTION_FAILURE',
      'TOKEN_ENDPOINT_TLS_FAILURE','TOKEN_ENDPOINT_UNEXPECTED_RESPONSE']);
    process.stderr.write('BLOCKED: '+(allow.has(error?.code)?error.code:'WORKSPACE_OAUTH_UNCERTAIN')+'\n');
    process.exitCode=1;
  });
}
