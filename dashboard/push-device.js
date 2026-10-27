/* Optional Phase 6E browser Push: no automatic permission prompt,
 * no account tokens/keys/job contents in browser persistent storage.
 * Device UUID and pending-revoke marker alone live in IndexedDB. */
const PushDevice=(()=>{
  const DB='fwh-alert-device-v1',STORE='identities';
  function supported(){
    if(!globalThis.isSecureContext||!('serviceWorker' in navigator)
      ||!('PushManager' in window)||!('Notification' in window))return false;
    const ua=navigator.userAgent||'';
    if(/iPhone|iPad|iPod|Firefox|Safari/i.test(ua)&&!/Chrome|Edg/i.test(ua))return false;
    return /Android.*Chrome|Chrome.*Android|Edg\/|Chrome\//i.test(ua);
  }
  const scope=()=>new URL('./',location.href);
  function openStore(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'key'});
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||Error('Device identity unavailable.'));
    });
  }
  async function record(key,write=null){
    const db=await openStore();
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,write?'readwrite':'readonly');
      const op=write?tx.objectStore(STORE).put({key,...write}):
        tx.objectStore(STORE).get(key);
      op.onsuccess=()=>resolve(write?write:op.result||null);
      op.onerror=()=>reject(op.error);
    });}finally{db.close();}
  }
  const key=(user,org)=>user+':'+org;
  function sameSession(user,org,token){
    return !!token && accessToken===token && currentUser?.id===user
      && currentUser?.app_metadata?.organization_id===org;
  }
  const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  function vapidBytes(str){
    const padded=str.replace(/-/g,'+').replace(/_/g,'/')+
      '='.repeat((4-str.length%4)%4);
    return Uint8Array.from(atob(padded),x=>x.charCodeAt(0));
  }
  async function rpc(name,body,token){
    const response=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
      method:'POST',headers:{'Content-Type':'application/json',
        Authorization:'Bearer '+token,apikey:SUPABASE_PUBLISHABLE_KEY},
      body:JSON.stringify(body)});
    if(!response.ok)throw Error(await readableError(response,'Device update unconfirmed.'));
    return response.json();
  }
  async function enroll(className,settings){
    if(!supported()||!settings?.push_ready||!settings.vapid_public_key
      ||!['PHONE','COMPUTER'].includes(className))
      throw Error('Verified supported browser and server push activation are required.');
    const mobile=/Android/i.test(navigator.userAgent);
    if(mobile !== (className==='PHONE'))throw Error('Choose the correct phone/computer device class.');
    const token=accessToken,user=currentUser?.id,org=currentUser?.app_metadata?.organization_id;
    if(!token||!user||org!==settings.organization_id)throw Error('Current office session changed.');
    // The ONLY permission prompt in FWH: deliberate click from this device.
    const existing=await record(key(user,org));
    if(!sameSession(user,org,token))throw Error('Session switched while enrolling.');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw Error('Browser/OS notification permission was not granted.');
    if(!sameSession(user,org,token))throw Error('Session switched while enrolling.');
    const registration=await navigator.serviceWorker.register(
      new URL('push-sw.js',scope()),{scope:scope().pathname});
    if(new URL(registration.scope).pathname!==scope().pathname)
      throw Error('Hosted dashboard worker scope mismatch.');
    if(!sameSession(user,org,token))throw Error('Session switched while enrolling.');
    const device_id=existing?.device_id||crypto.randomUUID();
    let subscription=null,created=false;
    try{
      const old=await registration.pushManager.getSubscription();
      if(!sameSession(user,org,token))throw Error('Session switched while enrolling.');
      // A subscription is scoped to the browser/worker, NOT to its signed-in
      // office account. Never bind an unowned older subscription to a new user.
      if(old&&!existing?.device_id)
        throw Error('This browser has an existing push subscription not owned by this office account.');
      subscription=old||await registration.pushManager.subscribe({
        userVisibleOnly:true,applicationServerKey:vapidBytes(settings.vapid_public_key)});
      created=!old;
      if(!sameSession(user,org,token))throw Error('Session switched while enrolling.');
      const json=subscription.toJSON();
      if(!json.keys?.p256dh||!json.keys?.auth)
        throw Error('Browser push subscription missing encryption keys.');
      const result=await rpc('admin_enroll_push',{
        p_action:crypto.randomUUID(),p_device:device_id,p_class:className,
        p_endpoint:json.endpoint,p_p256dh:json.keys.p256dh,
        p_auth_secret:json.keys.auth,p_expected_revision:existing?.revision||null},token);
      if(!sameSession(user,org,token))
        throw Error('Session switched while enrolling.');
      await record(key(user,org),{device_id,revision:result.revision,
        device_class:className,pending_revoke:false});
      return result;
    }catch(error){
      if(created){
        // Only undo a newly created subscription. A failed reenrollment must
        // not destroy an existing, possibly still-working registration.
        await subscription.unsubscribe().catch(()=>{});
        await record(key(user,org),{device_id,revision:existing?.revision||null,
          device_class:className,pending_revoke:true}).catch(()=>{});
      }
      throw error;
    }
  }
  async function disableLocal(){
    if(!('serviceWorker' in navigator))return;
    const registration=await navigator.serviceWorker.getRegistration(scope().href);
    const sub=await registration?.pushManager.getSubscription();
    if(sub)await sub.unsubscribe();
  }
  async function disable(){
    const user=currentUser?.id,org=currentUser?.app_metadata?.organization_id;
    const token=accessToken;
    if(!sameSession(user,org,token))throw Error('Current office session unavailable.');
    const k=key(user,org),data=await record(k);
    if(!sameSession(user,org,token))throw Error('Session changed while disabling push.');
    if(!data?.device_id)
      throw Error('No push enrollment belongs to this account on this browser.');
    // Write the non-secret pending revoke BEFORE the browser side effect:
    // interruption cannot forget a server enrollment needing reconciliation.
    await record(k,{...data,pending_revoke:true});
    if(!sameSession(user,org,token))throw Error('Session changed while disabling push.');
    await disableLocal().catch(()=>{});
    if(!sameSession(user,org,token))throw Error('Session changed while disabling push.');
    const answer=await rpc('admin_disable_push',{
      p_action:crypto.randomUUID(),p_device:data.device_id,
      p_expected_revision:data.revision},token);
    await record(k,{...data,revision:answer.revision,pending_revoke:false});
  }
  async function reconcilePending(){
    const user=currentUser?.id,org=currentUser?.app_metadata?.organization_id;
    const token=accessToken;
    if(!sameSession(user,org,token))return;
    const keyName=key(user,org),saved=await record(keyName);
    if(!saved?.pending_revoke||!saved.device_id)return;
    // A pending revoke belongs to the captured actor, not whoever signed in
    // while IndexedDB/network operations were awaiting their responses.
    if(!sameSession(user,org,token))return;
    await disableLocal().catch(()=>{});
    if(!sameSession(user,org,token))return;
    const receipt=await rpc('admin_disable_push',{
      p_action:crypto.randomUUID(),p_device:saved.device_id,
      p_expected_revision:saved.revision},token);
    if(!sameSession(user,org,token))return;
    await record(keyName,{...saved,revision:receipt.revision,pending_revoke:false});
  }
  async function localEnabled(devices){
    const user=currentUser?.id,org=currentUser?.app_metadata?.organization_id;
    if(!user||!org||!Array.isArray(devices))return false;
    // The server list is scoped to this office user. Its other devices must
    // never enable this browser's local Disable button.
    const saved=await record(key(user,org));
    return !!saved?.device_id && devices.some(device=>
      device.device_id===saved.device_id && device.enabled===true);
  }
  function signedOut(){
    const user=currentUser?.id,org=currentUser?.app_metadata?.organization_id;
    const token=accessToken;
    if(!user||!org)return;
    // Start local unsubscription immediately, and revoke server enrollment
    // with the old exact actor's token only. Never persist the token.
    const local=disableLocal().catch(()=>{});
    Promise.all([local,record(key(user,org))]).then(async([,data])=>{
      if(!data?.device_id)return;
      await record(key(user,org),{...data,pending_revoke:true});
      if(!token)return;
      try{
        const res=await fetch(SUPABASE_URL+'/rest/v1/rpc/admin_disable_push',{
          method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,
            Authorization:'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({p_action:crypto.randomUUID(),p_device:data.device_id,
            p_expected_revision:data.revision}),signal:AbortSignal.timeout(10000)});
        if(res.ok){
          const receipt=await res.json();
          await record(key(user,org),{...data,revision:receipt.revision,pending_revoke:false});
        }
      }catch{/* Offline signout leaves a durable non-secret pending revoke. */}
    }).catch(()=>{});
  }
  return {supported,enroll,disable,signedOut,reconcilePending,localEnabled};
})();
