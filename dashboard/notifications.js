/* Phase 6E: one Admin session-scoped alert center. All work facts,
   permissions, snooze and configuration revisions are server owned.
   Browser never stores push keys, sessions, job details or alert contents. */
const NotificationCenter=(()=>{
  let seq=0,settings=null,issues=[],busy=false,owner='',organization='';
  const el=id=>document.getElementById(id);
  const LABELS={
    READY_FOR_REVIEW:'Ready for photo review',
    FOLLOWUP_READY_FOR_REVIEW:'Corrective photos ready',
    ASSIGNMENT_NEEDS_ACCEPT:'Awaiting contractor Accept',
    ACCEPT_REMINDER:'Accept reminder (delayed)',
    OVERDUE:'Past due date',
    UPLOAD_PROBLEM:'No recent upload progress',
    APP_OR_SYNC_PROBLEM:'App or sync problem',
    DELIVERY_PROBLEM:'Client delivery problem',
    CLIENT_DELIVERED:'Client package delivered'
  };
  function clearDisplayed(){
    // A failed refresh must not leave old alerts or write controls looking current.
    el('notification-settings').replaceChildren();
    el('notification-list').replaceChildren();
    el('notification-count').textContent='Alerts not loaded';
    el('notification-push-enable').disabled=true;
    el('notification-push-disable').disabled=true;
    el('notification-org-timezone').value='';
    el('notification-timezone-save').disabled=true;
  }
  function reset(){
    seq++;settings=null;issues=[];busy=false;owner='';organization='';
    clearDisplayed();
    el('notification-status').textContent='';
    el('notification-org-timezone').value='America/Chicago';
    el('notification-push-status').textContent=
      'Phone and computer push has not passed provider activation. No device is enrolled by opening this page.';
  }
  function current(n,token){
    return seq===n&&accessToken===token&&currentUser?.id===owner
      &&currentUser?.app_metadata?.organization_id===organization;
  }
  function status(text){el('notification-status').textContent=text;}
  async function rpc(name,body,token){
    const res=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
      method:'POST',headers:{'Content-Type':'application/json',
        apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token},
      body:JSON.stringify(body)});
    if(!res.ok)throw Error(await readableError(res,'Notification operation not confirmed.'));
    return res.json();
  }
  function sectionHeading(label){
    const h=document.createElement('h3');h.textContent=label;return h;
  }
  function toggle(label,checked,disabled=false){
    const l=document.createElement('label');l.className='check';
    const input=document.createElement('input');input.type='checkbox';
    input.checked=checked;input.disabled=disabled;
    l.append(input,document.createTextNode(label));return [l,input];
  }
  function renderSettings(){
    const host=el('notification-settings');host.replaceChildren();
    host.append(sectionHeading('Choose your alerts'));
    for(const item of settings.types){
      // Quiet hours are stored per alert type. Sharing inputs across rows
      // could silently copy another type's hours when saving a toggle.
      const quietPanel=document.createElement('details');
      quietPanel.className='notification-quiet';
      const quietSummary=document.createElement('summary');
      quietSummary.textContent='Quiet hours for '+(LABELS[item.type]||item.type);
      quietPanel.append(quietSummary);
      const quiet=document.createElement('div');quiet.className='form-grid';
      const timezone=document.createElement('label');timezone.textContent='Time zone';
      const tzInput=document.createElement('input');
      tzInput.placeholder='America/Chicago';
      tzInput.value=item.quiet_timezone||'America/Chicago';
      timezone.append(tzInput);
      const start=document.createElement('label');start.textContent='Quiet start (optional)';
      const startInput=document.createElement('input');startInput.type='time';
      startInput.value=item.quiet_start?.slice(0,5)||'';
      start.append(startInput);
      const end=document.createElement('label');end.textContent='Quiet end (optional)';
      const endInput=document.createElement('input');endInput.type='time';
      endInput.value=item.quiet_end?.slice(0,5)||'';
      end.append(endInput);
      quiet.append(timezone,start,end);quietPanel.append(quiet);
      const row=document.createElement('div');row.className='notification-preference';
      const title=document.createElement('strong');title.textContent=LABELS[item.type]||item.type;
      const options=document.createElement('div');options.className='workspace-navigation';
      const [dashLabel,dash]=toggle('Dashboard',item.dashboard);
      const [phoneLabel,phone]=toggle('Phone',item.phone,!settings.push_ready);
      const [computerLabel,computer]=toggle('Computer',item.computer,!settings.push_ready);
      options.append(dashLabel,phoneLabel,computerLabel);
      const delay=document.createElement('input');delay.type='number';
      delay.min='1';delay.max='40320';delay.value=item.reminder_minutes;
      delay.setAttribute('aria-label','Delay minutes for '+item.type);
      if(item.type!=='ACCEPT_REMINDER')delay.hidden=true;
      const save=document.createElement('button');save.type='button';
      save.className='secondary';save.textContent='Save '+(LABELS[item.type]||item.type);
      save.addEventListener('click',async()=>{
        if(busy)return;
        const qstart=startInput.value||null,qend=endInput.value||null;
        const qzone=qstart&&qend?tzInput.value.trim():null;
        if((qstart&&!qend)||(!qstart&&qend)
          ||(qstart&&qend&&qstart===qend)
          ||(qstart&&qend&&!validIanaZone(qzone))){
          status('Quiet hours need a valid IANA time zone and different start/end times.');return;
        }
        const mins=Number(delay.value);
        if(!Number.isInteger(mins)||mins<1||mins>40320){
          status('Accept reminder delay must be between 1 and 40320 minutes.');return;
        }
        await mutate('admin_set_notification_preferences',{
          p_action:crypto.randomUUID(),p_type:item.type,
          p_expected_revision:item.revision,p_dashboard:dash.checked,
          p_phone:phone.checked,p_computer:computer.checked,
          p_reminder_minutes:mins,p_quiet_timezone:qzone,
          p_quiet_start:qstart,p_quiet_end:qend});
      });
      row.append(title,options,delay,save,quietPanel);host.append(row);
    }
  }
  function validIanaZone(s){
    // UTC is an IANA zone too; not every valid identifier contains a slash.
    if(s!=='UTC'&&!s.includes('/'))return false;
    try{new Intl.DateTimeFormat('en-US',{timeZone:s});return true;}catch{return false;}
  }
  function renderAlerts(){
    const host=el('notification-list');host.replaceChildren();
    el('notification-count').textContent=
      issues.filter(x=>x.current&&!x.acknowledged).length+
      ' current unread alerts in this bounded view';
    const currentIssues=issues.filter(item=>item.current);
    if(currentIssues.length===0){
      const p=document.createElement('p');p.className='muted';
      p.textContent='No current alerts in the latest server-evaluated work orders.';
      host.append(p);return;
    }
    const list=document.createElement('ol');
    for(const item of currentIssues){
      const li=document.createElement('li');li.className='notification-item';
      const title=document.createElement('strong');
      title.textContent=LABELS[item.type]||item.type;
      const details=document.createElement('p');details.className='muted';
      details.textContent=(item.acknowledged?'Acknowledged · ':'')+
        (item.snoozed_until?'Snoozed until '+new Date(item.snoozed_until).toLocaleString()+' · ':'')+
        'Server-confirmed issue · '+new Date(item.first_at).toLocaleString();
      const actions=document.createElement('div');actions.className='workspace-navigation';
      const open=document.createElement('button');open.type='button';
      open.className='secondary';open.textContent='Open work order';
      open.addEventListener('click',()=>JobWorkspace.choose(item.work_order_id));
      const acknowledge=document.createElement('button');acknowledge.type='button';
      acknowledge.className='secondary';acknowledge.textContent='Acknowledge';
      acknowledge.disabled=!!item.acknowledged;
      acknowledge.addEventListener('click',()=>mutate('admin_alert_receipt_action',{
        p_action:crypto.randomUUID(),p_issue:item.id,
        p_expected_revision:item.receipt_revision||null,
        p_mode:'ACKNOWLEDGE',p_snoozed_until:null}));
      const snooze=document.createElement('button');snooze.type='button';
      snooze.className='secondary';snooze.textContent='Snooze 4 hours';
      snooze.addEventListener('click',()=>mutate('admin_alert_receipt_action',{
        p_action:crypto.randomUUID(),p_issue:item.id,
        p_expected_revision:item.receipt_revision||null,
        p_mode:'SNOOZE',p_snoozed_until:new Date(Date.now()+4*3600000).toISOString()}));
      actions.append(open,acknowledge,snooze);li.append(title,details,actions);list.append(li);
    }
    host.append(list);
  }
  async function load(){
    if(!accessToken||!currentUser)return;
    const n=++seq,token=accessToken;
    owner=currentUser.id;organization=currentUser.app_metadata?.organization_id||'';
    // Clear potentially stale, still-clickable results *before* the first
    // network request. A denied/offline refresh leaves a truthful empty view.
    settings=null;issues=[];clearDisplayed();
    if(!organization){status('Notification scope unavailable.');return;}
    status('Loading current, scoped notification settings and alert facts…');
    try{
      const nextSettings=await rpc('admin_notification_settings',{},token);
      if(!current(n,token))return;
      if(nextSettings.organization_id!==organization||
         !Array.isArray(nextSettings.types)||nextSettings.types.length!==9)
        throw Error('Settings scope mismatch.');
      settings=nextSettings;
      // A prior offline Sign Out may have persisted only a non-secret device
      // revoke marker. The SAME authenticated owner reconciles it here.
      await PushDevice.reconcilePending().catch(()=>{});
      if(!current(n,token))return;
      const list=await rpc('admin_alert_list',{
        p_limit:25,p_after_created:null,p_after_issue:null},token);
      if(!current(n,token))return;
      if(list.organization_id!==organization||!Array.isArray(list.alerts)
        ||list.alerts.length>25)
        throw Error('Alert list scope mismatch.');
      issues=list.alerts;
      const localDeviceEnabled=await PushDevice.localEnabled(settings.devices).catch(()=>false);
      if(!current(n,token))return;
      el('notification-org-timezone').value=
        settings.organization_timezone||'America/Chicago';
      el('notification-timezone-save').disabled=false;
      el('notification-push-status').textContent=settings.push_ready
        ?'This device must be explicitly enrolled before receiving push. Browser/OS permission does not guarantee delivery.'
        :'Phone and computer push is not configured or verified. Settings remain Off; no push notifications are being sent.';
      el('notification-push-enable').disabled=
        !settings.push_ready||!PushDevice.supported();
      el('notification-push-disable').disabled=!localDeviceEnabled;
      if(!PushDevice.supported())
        el('notification-push-status').textContent+=
          ' This browser/device is not in the supported Chrome/Edge enrollment set.';
      renderSettings();renderAlerts();
      status('Loaded current server facts. Unobserved offline phone state is not interpreted as an error.');
    }catch(error){if(current(n,token))status('Notification status unavailable: '+error.message);}
  }
  async function mutate(name,body){
    if(busy||!accessToken||!currentUser)return;
    const n=seq,token=accessToken;busy=true;
    status('Saving a revision-controlled notification change…');
    try{
      await rpc(name,body,token);
      if(!current(n,token))return;
      await load();
    }catch(error){if(current(n,token))
      status('Save outcome unconfirmed. Reload before trying again. '+error.message);}
    finally{busy=false;}
  }
  function init(){
    reset();
    el('notification-center').addEventListener('toggle',()=>{
      if(el('notification-center').open&&accessToken)load();
    });
    el('notification-refresh').addEventListener('click',load);
    el('notification-push-enable').addEventListener('click',async()=>{
      if(busy||!settings?.push_ready||!PushDevice.supported())return;
      const klass=el('notification-device-class').value;
      busy=true;status('Requesting permission for this exact browser/device…');
      try{
        await PushDevice.enroll(klass,settings);
        status('Device enrolled with the server. Push service acceptance and actual OS display still require real tests.');
        await load();
      }catch(error){status('Push enrollment not confirmed: '+error.message);}
      finally{busy=false;}
    });
    el('notification-push-disable').addEventListener('click',async()=>{
      if(busy)return;busy=true;
      try{await PushDevice.disable();status('Local push disabled. Server revocation attempted; reload to verify device state.');await load();}
      catch(error){status('Local push unsubscribed. Server revocation unconfirmed; device will need reconciliation. '+error.message);}
      finally{busy=false;}
    });
    el('notification-timezone-save').addEventListener('click',()=>{
      if(!settings)return;
      const timezone=el('notification-org-timezone').value.trim();
      if(!validIanaZone(timezone)){
        status('Enter a real IANA time zone, such as America/Chicago.');return;}
      mutate('admin_configure_alert_timezone',{
        p_action:crypto.randomUUID(),p_expected_revision:
          settings.organization_timezone_revision||null,p_timezone:timezone});
    });
  }
  return {init,reset,load};
})();
document.addEventListener('DOMContentLoaded',NotificationCenter.init);
