/* Phase 5C: one office-authorized review pane, no browser-owned credentials or URLs. */
const PrivateReview = (() => {
  let current = '', generation = 0, next = null, entries = [];
  let currentRun = '', selected = new Map(), inspected = new Map();
  let bulkBusy = false, uncertain = false, inspectionIndex = 0;
  const el = id => document.getElementById(id);
  const UUID = /^[a-f0-9-]{36}$/i;

  function reset() {
    generation++; current = ''; next = null; entries = [];
    currentRun = ''; selected.clear(); inspected.clear(); bulkBusy = false; uncertain = false;
    inspectionIndex = 0;
    for(const id of ['private-review-run','private-review-item','private-review-stage','private-review-decision'])
      if(el(id)) el(id).value='';
    if(el('private-review-size')) el('private-review-size').value='25';
    if(el('private-review-bulk-reason')) el('private-review-bulk-reason').value='';
    if(el('private-review-selected-count')) el('private-review-selected-count').textContent='0 photos selected';
    const list = el('private-review-list');
    if (list) list.replaceChildren();
    const status = el('private-review-status'); if (status) status.textContent = '';
    const more = el('private-review-more'); if (more) more.hidden = true;
  }
  function active(gen, wo, token) {
    return gen === generation && current === wo && accessToken && accessToken === token
      && editWorkOrderIdInput.value === wo;
  }
  function status(message, error = false) {
    const node = el('private-review-status'); node.textContent = message;
    node.classList.toggle('error', error);
  }
  async function rpc(name, payload, token) {
    if (!token) throw new Error('Sign in before reviewing private photos.');
    const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await readableError(response, 'Private review is unavailable. No photos were changed.'));
    return response.json();
  }
  async function viewer(payload, token) {
    const response = await adminFetch(`${SUPABASE_URL}/functions/v1/admin-private-photo`, {
      method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Private image preview is unavailable. Review has not been changed.');
    return response.json();
  }
  function actionButton(label, action, disabled = true) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary'; button.textContent = label;
    button.disabled = disabled; button.addEventListener('click', action); return button;
  }
  function selectionStatus(){
    el('private-review-selected-count').textContent=selected.size+' photo(s) selected (max 50)';
    el('private-review-bulk-approve').disabled=bulkBusy||uncertain||selected.size===0;
    el('private-review-bulk-reject').disabled=bulkBusy||uncertain||selected.size===0
      ||!el('private-review-bulk-reason').value.trim();
    el('private-review-previous-photo').disabled=entries.length===0||inspectionIndex<=0;
    el('private-review-next-photo').disabled=entries.length===0||inspectionIndex>=entries.length-1;
  }
  function render() {
    const list = el('private-review-list'); list.replaceChildren();
    if (entries.length === 0) {
      status('No verified photos match this exact run/category/stage/decision filter, or private receipts remain pending.');
      selectionStatus();return;
    }
    status('Only privately verified photos are listed here. Nothing is sent to a client from this screen.');
    for (const item of entries) {
      const row = document.createElement('article'); row.className = 'private-review-photo';
      const heading = document.createElement('strong');
      heading.textContent = `Photo ${item.photo_id.slice(0,8)} · ${item.decision}`;
      const detail = document.createElement('p'); detail.className = 'muted';
      detail.textContent = 'Run '+item.run_sequence+' · '+(item.requirement_label||'Extra')+
        ' · '+(item.stage||'NONE')+' · Taken '+formatTimestamp(item.captured_at)+
        ' · Receipt '+formatTimestamp(item.verified_at);
      const preview = document.createElement('div'); preview.className = 'private-review-preview';
      row.dataset.reviewPhotoId=item.photo_id;
      const selectedLabel=document.createElement('label'); selectedLabel.className='check';
      const choose=document.createElement('input');choose.type='checkbox';
      choose.setAttribute('aria-label','Select reviewed photo '+item.photo_id);
      choose.checked=selected.has(item.photo_id);
      choose.disabled=bulkBusy||uncertain||inspected.get(item.photo_id)!==item.transfer_version;
      choose.addEventListener('change',()=>{
        if(choose.checked){
          if(selected.size>=50){choose.checked=false;status('Select at most 50 inspected photos per bulk action.',true);return;}
          selected.set(item.photo_id,{photo_id:item.photo_id,transfer_version:item.transfer_version,
            expected_revision:item.decision_revision||null,run_id:item.run_id});
        }else selected.delete(item.photo_id);
        selectionStatus();
      });
      selectedLabel.append(choose,document.createTextNode(' Select for bulk review'));
      const controls = document.createElement('div'); controls.className = 'workspace-navigation';
      const explanation = document.createElement('input');
      explanation.type = 'text'; explanation.maxLength = 1000;
      explanation.placeholder = 'Reason for rejecting this photo';
      explanation.setAttribute('aria-label', 'Photo rejection reason');
      const review = async decision => {
        const gen = generation, wo = current, token = accessToken;
        if (!active(gen,wo,token)) return;
        const reason = decision === 'REJECTED' ? explanation.value.trim() : '';
        if (decision === 'REJECTED' && !reason) {
          status('Enter a reason before rejecting a photo.', true); explanation.focus(); return;
        }
        approval.disabled = true; rejection.disabled = true;
        status('Saving photo review…');
        try {
          await rpc('admin_review_photo', { p_action: crypto.randomUUID(), p_work_order: wo,
            p_photo: item.photo_id, p_transfer_version: item.transfer_version,
            p_expected_revision: item.decision_revision, p_decision: decision, p_reason: reason }, token);
          if (active(gen,wo,token)){
            selected.delete(item.photo_id); inspected.delete(item.photo_id);
            await load(false);
          }
        } catch (error) {
          if (active(gen,wo,token)) {
            status('Review not saved: ' + error.message + ' Reload verified photos before retrying.', true);
            approval.disabled = true; rejection.disabled = true;
          }
        }
      };
      const approval = actionButton('Approve', () => review('APPROVED'));
      const rejection = actionButton('Reject', () => review('REJECTED'));
      const show = actionButton('Preview photo', async () => {
        const gen = generation, wo = current, token = accessToken;
        show.disabled = true; approval.disabled = true; rejection.disabled = true;
        preview.replaceChildren(); status('Loading verified photo preview…');
        try {
          const signed = await viewer({ photo_id: item.photo_id, transfer_version: item.transfer_version }, token);
          if (!active(gen,wo,token)) return;
          if (signed.photo_id !== item.photo_id || signed.transfer_version !== item.transfer_version
            || !Number.isInteger(signed.expires_in) || signed.expires_in < 1 || signed.expires_in > 300
            || typeof signed.url !== 'string') throw new Error('Untrusted preview response.');
          const expected = [currentUser?.app_metadata?.organization_id, wo, item.run_id, item.photo_id + '.jpg'];
          if (expected.some(part => typeof part !== 'string' || !part)) throw new Error('Photo identity is unavailable.');
          const expectedPath = '/storage/v1/object/sign/fwh-review-private/' + expected.map(encodeURIComponent).join('/');
          const url = new URL(signed.url);
          if (url.protocol !== 'https:' || url.origin !== SUPABASE_URL
            || url.pathname !== expectedPath || url.searchParams.size !== 1
            || !url.searchParams.get('token')) throw new Error('Untrusted private preview URL.');
          const img = document.createElement('img'); img.alt = 'Privately verified work photo';
          img.referrerPolicy = 'no-referrer'; img.loading = 'eager';
          img.addEventListener('load', () => {
            if (!active(gen,wo,token)) return;
            approval.disabled = false; rejection.disabled = false;
            inspected.set(item.photo_id,item.transfer_version);
            choose.disabled=bulkBusy||uncertain;
            status('Verified photo inspected. You may review or select this exact version.');
          }, { once: true });
          img.addEventListener('error', () => {
            if (active(gen,wo,token)) status('Could not load the verified image. No review decision is available.', true);
          }, { once: true });
          preview.replaceChildren(img); img.src = url.toString();
        } catch (error) {
          if (active(gen,wo,token)) status(error.message || 'Private photo preview unavailable.', true);
        } finally { if (active(gen,wo,token)) show.disabled = false; }
      }, false);
      const addIssue=actionButton('Add correction issue',()=>{
        const reason=explanation.value.trim()||item.reason||'';
        if(!CorrectionDraft.addIssue(item,reason))explanation.focus();
      },false);
      controls.append(show, approval, rejection, addIssue);
      const reference=document.createElement('label');reference.className='check';
      const refChoice=document.createElement('input');refChoice.type='checkbox';
      refChoice.dataset.correctionPhotoId=item.photo_id;
      refChoice.checked=CorrectionDraft.hasReference(item.photo_id);
      refChoice.addEventListener('change',()=>{
        if(!CorrectionDraft.reference(item.photo_id,refChoice.checked))
          refChoice.checked=CorrectionDraft.hasReference(item.photo_id);
      });
      reference.append(refChoice,document.createTextNode(' Reference in follow-up'));
      row.append(heading, detail, selectedLabel, preview, controls, explanation, reference);
      list.append(row);
    }
    selectionStatus();
  }
  async function load(append = false) {
    const wo = current, token = accessToken, gen = generation;
    if (!wo || !token) return;
    status('Loading verified private photos…');
    const cursor = append ? next : null;
    if (!append) { next = null; entries = []; inspectionIndex=0; }
    const runFilter=el('private-review-run').value==='CURRENT'?currentRun:null;
    const itemValue=el('private-review-item').value;
    try {
      const data = await rpc('admin_review_photo_page',{
        p_wo:wo,p_limit:Number(el('private-review-size').value),
        p_after_sequence:cursor?.sequence||null,p_after_photo:cursor?.photo||null,
        p_run:runFilter||null,p_item:itemValue&&itemValue!=='EXTRA'?itemValue:null,
        p_extra:itemValue==='EXTRA',
        p_stage:el('private-review-stage').value||null,
        p_decision:el('private-review-decision').value||null},token);
      if (!active(gen,wo,token)) return;
      if (data.work_order_id!==wo || !Array.isArray(data.photos)
        || data.photos.length>Number(el('private-review-size').value)
        || data.photos.some(p=>!UUID.test(p.photo_id)||!UUID.test(p.transfer_version)
            || !UUID.test(p.run_id)||!Number.isInteger(p.run_sequence)
            || !['PENDING','APPROVED','REJECTED'].includes(p.decision))) {
        throw new Error('Private photo list identity mismatch.');
      }
      entries=append?[...entries,...data.photos]:data.photos;
      next=data.next_photo&&Number.isInteger(data.next_sequence)
        ?{sequence:data.next_sequence,photo:data.next_photo}:null;
      el('private-review-more').hidden=!next;
      render();
    } catch (error) {
      if (active(gen,wo,token)) {
        el('private-review-more').hidden = true;
        status('Private review unavailable. No action taken. ' + error.message, true);
      }
    }
  }
  function applyFilter(){
    selected.clear();inspected.clear();uncertain=false;next=null;
    load(false);
  }
  function populateCategories(){
    const control=el('private-review-item');control.replaceChildren(new Option('All categories',''));
    control.add(new Option('Extra photos','EXTRA'));
    for(const item of editPhotos.value?.items||[]){
      if(UUID.test(item.id))control.add(new Option(item.label,item.id));
    }
  }
  async function bulk(decision,allReviewed=false){
    if(bulkBusy||uncertain||!current)return;
    if(allReviewed){
      for(const entry of entries){
        if(entry.decision==='PENDING'&&inspected.get(entry.photo_id)===entry.transfer_version){
          if(selected.size>=50)break;
          selected.set(entry.photo_id,{photo_id:entry.photo_id,
            transfer_version:entry.transfer_version,
            expected_revision:entry.decision_revision||null,run_id:entry.run_id});
        }
      }
    }
    if(selected.size===0){
      status('Preview the private photos first. Only inspected current versions can be bulk reviewed.',true);return;
    }
    const reason=decision==='REJECTED'?el('private-review-bulk-reason').value.trim():'';
    if(decision==='REJECTED'&&!reason){
      status('Enter one explicit reason for the selected rejections.',true);return;
    }
    const photos=[...selected.values()].map(p=>({
      photo_id:p.photo_id,transfer_version:p.transfer_version,
      expected_revision:p.expected_revision})).sort((a,b)=>a.photo_id.localeCompare(b.photo_id));
    const runIds=[...new Set([...selected.values()].map(p=>p.run_id))];
    const scopedRun=runIds.length===1?runIds[0]:null;
    const summary=photos.length+' exact inspected photo(s) · '+
      (scopedRun?'single run '+scopedRun.slice(0,8):'multiple runs')+
      ' · '+decision+
      (reason?' · Reason: '+reason:'')+
      '. No unseen or newly arriving photo will be changed. Confirm?';
    if(!window.confirm(summary)){selectionStatus();return;}
    const gen=generation,wo=current,token=accessToken;
    bulkBusy=true;selectionStatus();status('Saving exact selected photo review…');
    try{
      const response=await rpc('admin_review_photos_bulk',{
        p_action:crypto.randomUUID(),p_work_order:wo,p_run:scopedRun,
        p_photos:photos,p_decision:decision,p_reason:reason},token);
      if(!active(gen,wo,token))return;
      if(response.work_order_id!==wo||!['APPLIED','CONFLICT'].includes(response.outcome))
        throw Error('Unexpected bulk review receipt. Reload to verify.');
      selected.clear();inspected.clear();
      if(response.outcome==='CONFLICT'){
        await load(false);
        if(active(gen,wo,token))status('Nothing changed. '+response.conflicts.length+
          ' selected photo(s) changed. Inspect the new versions before choosing again.',true);
      }else{
        await load(false);
        if(active(gen,wo,token)){
          status('Saved '+response.applied+' selected review decision(s). No client package was sent.');
          ClientRelease.open(wo,'photos');
        }
      }
    }catch(error){
      if(active(gen,wo,token)){
        uncertain=true;
        status('Bulk review outcome unknown. Do not repeat blindly. Refresh this exact photo page to reconcile. '+error.message,true);
      }
    }finally{
      if(active(gen,wo,token)){bulkBusy=false;selectionStatus();}
    }
  }
  function navigate(delta){
    inspectionIndex=Math.max(0,Math.min(entries.length-1,inspectionIndex+delta));
    const entry=entries[inspectionIndex];
    document.querySelector('[data-review-photo-id="'+entry?.photo_id+'"]')
      ?.scrollIntoView({block:'nearest'});
    selectionStatus();
  }
  function open(wo,runId=null){
    if(!wo)return;
    if(current!==wo){
      reset();current=wo;
      currentRun=UUID.test(runId||'')?runId:
        workOrderRows.find(r=>r.id===wo)?.current_run_id||'';
      populateCategories();
    }
    load(false);
  }
  function init(){
    el('private-review-more').addEventListener('click',()=>load(true));
    for(const id of ['private-review-run','private-review-item','private-review-stage',
      'private-review-decision','private-review-size'])
      el(id).addEventListener('change',applyFilter);
    el('private-review-bulk-reason').addEventListener('input',selectionStatus);
    el('private-review-select-reviewed').addEventListener('click',()=>{
      for(const item of entries)if(item.decision==='PENDING' &&
        inspected.get(item.photo_id)===item.transfer_version && selected.size<50)
        selected.set(item.photo_id,{photo_id:item.photo_id,
          transfer_version:item.transfer_version,
          expected_revision:item.decision_revision||null,run_id:item.run_id});
      render();
    });
    el('private-review-clear-selection').addEventListener('click',()=>{
      selected.clear();render();
    });
    el('private-review-bulk-approve').addEventListener('click',()=>bulk('APPROVED'));
    el('private-review-bulk-reject').addEventListener('click',()=>bulk('REJECTED'));
    el('private-review-previous-photo').addEventListener('click',()=>navigate(-1));
    el('private-review-next-photo').addEventListener('click',()=>navigate(1));
  }
  return { init, open, reset };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PrivateReview;
