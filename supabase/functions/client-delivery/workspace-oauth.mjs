// Backend-only OAuth refresh. The chosen Workspace user must also pass Drive
// about.get and the configured client-root capability check after refreshing.
// No refresh token, access token or client secret may enter browser/Android,
// source, logs, provider journal or a response to the Admin.
export class OAuthUnavailable extends Error {
  constructor(code) { super(code); this.name = 'OAuthUnavailable'; this.code = code; }
}
const TOKEN_ENDPOINT='https://oauth2.googleapis.com/token';
const DRIVE_SCOPES=new Set([
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file'
]);
export function createWorkspaceTokenProvider({
  clientId,clientSecret,refreshToken,requiredScope,fetcher=fetch
}={}) {
  const secret=v=>typeof v==='string' && v.length>=16 && v.length<=8192 && !/\s/.test(v);
  if (!secret(clientId)||!secret(clientSecret)||!secret(refreshToken)
      ||!DRIVE_SCOPES.has(requiredScope))
    throw new OAuthUnavailable('BACKEND_OAUTH_NOT_CONFIGURED');
  return async function refresh() {
    const form=new URLSearchParams({client_id:clientId,client_secret:clientSecret,
      refresh_token:refreshToken,grant_type:'refresh_token'});
    let response;
    try {
      response=await fetcher(TOKEN_ENDPOINT,{method:'POST',redirect:'error',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
        body:form.toString()});
    } catch { throw new OAuthUnavailable('OAUTH_OUTCOME_UNCERTAIN'); }
    if(!response.ok) {
      await response.body?.cancel().catch(()=>{});
      throw new OAuthUnavailable(response.status===400||response.status===401
        ? 'WORKSPACE_AUTHORIZATION_REQUIRED':'OAUTH_UNAVAILABLE');
    }
    let data;
    try {
      const raw=await response.text();
      if(raw.length>12000)throw new Error('token response too large');
      data=JSON.parse(raw);
    }catch{throw new OAuthUnavailable('OAUTH_UNAVAILABLE');}
    if(data?.token_type!=='Bearer'
      ||typeof data.access_token!=='string'
      ||data.access_token.length<20||data.access_token.length>8192
      ||!Number.isInteger(data.expires_in)||data.expires_in<60||data.expires_in>86400
      ||(data.scope!==undefined && (!data.scope.split(' ').includes(requiredScope))))
      throw new OAuthUnavailable('OAUTH_SCOPE_OR_TOKEN_INVALID');
    return {accessToken:data.access_token,expiresInSeconds:data.expires_in};
  };
}
