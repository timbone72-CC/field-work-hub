/* FWH Phase 6E, scoped exactly to its deployed dashboard directory.
 * No fetch handler, no Cache API, no job/photo/client data persistence. */
self.addEventListener('push',event=>{
  let data=null;
  try{data=event.data?.json()||null;}catch{return;}
  if(!data||typeof data!=='object'
    ||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).test(data.alert_id)
    ||typeof data.path!=='string'
    ||!(/^\.\/\?alert=[0-9a-f-]{36}$/i).test(data.path))return;
  const destination=new URL(data.path,self.registration.scope);
  if(destination.origin!==self.location.origin||
     !destination.href.startsWith(self.registration.scope))return;
  event.waitUntil(self.registration.showNotification(
    'Field Work Hub — an assigned job needs attention',{
      body:'Open Field Work Hub to check your current authorized alerts.',
      icon:new URL('fwh-icon.png',self.registration.scope).href,
      tag:'fwh-alert-'+data.alert_id,
      data:{path:data.path},renotify:false
    }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const raw=event.notification.data?.path;
  if(typeof raw!=='string'||!(/^\.\/\?alert=[0-9a-f-]{36}$/i).test(raw))return;
  const target=new URL(raw,self.registration.scope);
  if(target.origin!==self.location.origin||!target.href.startsWith(self.registration.scope))return;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const current=windows.find(w=>w.url.startsWith(self.registration.scope));
    if(current){await current.focus();if(current.navigate)await current.navigate(target.href);}
    else await self.clients.openWindow(target.href);
  })());
});
// Push payload never carries a client, address, photo URL, email or auth token.
// Authentication/current scope is rechecked by normal dashboard fetch.
