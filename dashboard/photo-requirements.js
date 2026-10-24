/* Optional requirements use one item per photo plus an independent total. */
const PhotoRules = {
  empty() { return { schema: 1, revision: crypto.randomUUID(), total: { enabled: false, minimum: 0 }, items: [] }; },
  validate(value) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const keys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v)
      && Object.keys(v).length === allowed.length && Object.keys(v).every(k => allowed.includes(k));
    const count = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
    if (!keys(value, ['schema', 'revision', 'total', 'items']) || value.schema !== 1 || !uuid.test(value.revision)
      || !keys(value.total, ['enabled', 'minimum']) || typeof value.total.enabled !== 'boolean'
      || !count(value.total.minimum, 5000) || (value.total.enabled && value.total.minimum === 0)
      || !Array.isArray(value.items) || value.items.length > 100) throw Error('Check the photo total and supported requirement fields.');
    const ids = new Set(), names = new Set(); let specified = 0;
    for (const item of value.items) {
      if (!keys(item, ['id', 'label', 'enabled', 'minimum', 'instruction', 'stage', 'framing', 'order'])
        || !uuid.test(item.id) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 100
        || item.label.trim().toLowerCase() === 'extra' || typeof item.enabled !== 'boolean' || !count(item.minimum, 1000)
        || (item.enabled && item.minimum === 0) || typeof item.instruction !== 'string' || item.instruction.length > 400
        || !['NONE', 'BEFORE', 'DURING', 'AFTER'].includes(item.stage) || !['NORMAL', 'WIDE', 'CLOSEUP'].includes(item.framing)
        || !count(item.order, 999) || ids.has(item.id) || names.has(item.label.trim().toLowerCase())) throw Error('Photo items need unique names, whole-number counts, and supported options.');
      ids.add(item.id); names.add(item.label.trim().toLowerCase()); if (item.enabled) specified += item.minimum;
    }
    if (specified > 5000) throw Error('Specified photos exceed the 5000-photo limit.');
    const total = value.total.enabled ? value.total.minimum : 0;
    return { specified, additional: Math.max(0, total - specified), minimum: Math.max(total, specified) };
  },
  suggestions(templates,workType,companyId=null) {
    const type=String(workType||'').trim().toLowerCase();
    if (!type || !Array.isArray(templates)) return [];
    const company=companyId||null;
    return templates.filter(t=>t?.active===true && typeof t.work_type==='string'
      && t.work_type.trim().toLowerCase()===type
      && (!t.company_id || (company && t.company_id===company)))
      .sort((a,b)=>Number(Boolean(b.is_default))-Number(Boolean(a.is_default))
        || Number(Boolean(b.company_id))-Number(Boolean(a.company_id))
        || String(a.name).localeCompare(String(b.name))
        || String(a.id).localeCompare(String(b.id)));
  },
  copyPriorSnapshot(value) {
    // A legacy job with no configured requirements is explicitly optional;
    // it must not inherit fabricated required photo categories.
    const copied=value && typeof value==='object' && !Array.isArray(value)
      && Object.keys(value).length ? structuredClone(value) : this.empty();
    this.validate(copied);
    copied.revision=crypto.randomUUID();
    return copied;
  },
  summary(value) {
    const c = this.validate(value);
    return c.minimum ? `${c.specified} specified photos${c.additional ? ` + at least ${c.additional} additional` : ''}. Minimum ${c.minimum} unique photos.` : 'Photos optional. Inspectors can still take Extra photos.';
  }
};
if (typeof module !== 'undefined') module.exports = PhotoRules;

class PhotoRequirementEditor {
  constructor(element, getWorkType, onTemplateApplied = null, manageTemplates = true) {
    this.manageTemplates = manageTemplates;
    this.element = element; this.getWorkType = getWorkType; this.onTemplateApplied = onTemplateApplied;
    this.value = PhotoRules.empty(); this.templates = []; this.selectedId = ''; this.locked = false;
    this.companyId = null; this.fetchEpoch = 0;
    this.render();
  }
  setCompany(companyId) {
    const next=companyId||null;
    if (this.companyId===next) return;
    this.companyId=next; this.refreshSuggestions();
  }
  clearAccount() {
    this.fetchEpoch++; this.templates=[]; this.companyId=null; this.load(null);
  }
  applicable() { return PhotoRules.suggestions(this.templates,this.getWorkType(),this.companyId); }
  load(value, locked = false) {
    this.value = value && Object.keys(value).length ? structuredClone(value) : PhotoRules.empty();
    this.legacy = !value || !Object.keys(value).length; this.expectedRevision = this.legacy ? null : value.revision;
    this.locked = locked; this.selectedId = ''; this.render();
  }
  snapshot() {
    if (this.locked && this.legacy) return null;
    PhotoRules.validate(this.value); return structuredClone(this.value);
  }
  async reloadTemplates() {
    const epoch=++this.fetchEpoch, token=accessToken;
    const response = await adminFetch(`${SUPABASE_URL}/rest/v1/photo_templates?select=*&order=name.asc`, { headers: authHeaders() });
    if (epoch!==this.fetchEpoch || token!==accessToken || !token) return;
    if (!response.ok) throw Error(await readableError(response, 'Unable to load photo templates.'));
    const templates=await response.json();
    if (epoch!==this.fetchEpoch || token!==accessToken || !token) return;
    if (!Array.isArray(templates)) throw Error('Unexpected template list.');
    this.templates=templates; this.refreshSuggestions();
  }
  refreshSuggestions() {
    if (this.selectedId && !this.applicable().some(t=>t.id===this.selectedId))
      this.selectedId='';
    this.render();
  }
  useDefault() {
    const t = this.applicable().find(t=>t.is_default);
    if (t && !this.locked) this.choose(t.id);
    else this.refreshSuggestions();
  }
  choose(id) {
    const t = this.applicable().find(t=>t.id===id);
    if (t) {
      PhotoRules.validate(t.requirements);
      if (this.onTemplateApplied && this.onTemplateApplied(t)===false) return;
    }
    this.selectedId=t?.id||'';
    this.value=t ? structuredClone(t.requirements) : PhotoRules.empty();
    this.value.revision=crypto.randomUUID(); this.render();
  }
  render() {
    const host = this.element; host.replaceChildren();
    const node = (tag, text, parent = host) => { const el = document.createElement(tag); if (text) el.textContent = text; parent.append(el); return el; };
    const input = (label, type, value, change, parent = host) => {
      const wrap = node('label', label, parent), el = node('input', '', wrap); el.type = type;
      if (type === 'checkbox') el.checked = value; else el.value = value;
      el.disabled = this.locked; el.addEventListener('change', () => { change(type === 'checkbox' ? el.checked : type === 'number' ? Number(el.value) : el.value); updateSummary(); }); return el;
    };
    const select = (label, choices, value, change, parent = host) => {
      const el = node('select', '', node('label', label, parent));
      for (const [key, name] of choices) { const option = node('option', name, el); option.value = key; }
      el.value = value; el.disabled = this.locked; el.addEventListener('change', () => change(el.value)); return el;
    };
    const action = (label, work, parent = host) => { const el = node('button', label, parent); el.type = 'button'; el.className = 'secondary'; el.disabled = this.locked; el.addEventListener('click', work); return el; };
    node('h3', 'Photo requirements');
    const suggested=this.applicable();
    select('Photo template', [['', 'Custom / all optional'], ...suggested.map(t => [t.id,
      `${t.name} · ${t.company_id?'This company':'Organization'}${t.is_default ? ' · default' : ''}`])],
      this.selectedId, id => this.choose(id));
    const summary = node('p', '', host); summary.className = 'muted';
    const updateSummary = () => { try { summary.textContent = PhotoRules.summary(this.value); } catch (e) { summary.textContent = e.message; } };
    if (this.locked) node('p', 'Requirements are frozen after Start. Dispatch details can still be edited.');
    const total = node('div', '', host); total.className = 'photo-total';
    input('Require a total', 'checkbox', this.value.total.enabled, v => this.value.total.enabled = v, total);
    const minimum = input('Minimum total photos', 'number', this.value.total.minimum, v => this.value.total.minimum = v, total); minimum.min = '0'; minimum.max = '5000'; minimum.step = '1';
    this.value.items.forEach((item, index) => {
      const row = node('fieldset'); row.className = 'photo-item';
      input('Required', 'checkbox', item.enabled, v => item.enabled = v, row);
      const label = input('Photo item', 'text', item.label, v => item.label = v.trim(), row); label.maxLength = 100;
      const count = input('Minimum photos', 'number', item.minimum, v => item.minimum = v, row); count.min = '0'; count.max = '1000'; count.step = '1';
      const details = node('details', '', row); node('summary', 'Instructions and framing', details);
      const instruction = input('Short instruction (optional)', 'text', item.instruction, v => item.instruction = v, details); instruction.maxLength = 400;
      select('Stage hint', ['NONE', 'BEFORE', 'DURING', 'AFTER'].map(v => [v, v === 'NONE' ? 'No stage' : v]), item.stage, v => item.stage = v, details);
      select('Framing hint', ['NORMAL', 'WIDE', 'CLOSEUP'].map(v => [v, v]), item.framing, v => item.framing = v, details);
      const move = offset => { const other = index + offset; if (other < 0 || other >= this.value.items.length) return;
        [this.value.items[index], this.value.items[other]] = [this.value.items[other], this.value.items[index]];
        this.value.items.forEach((v, n) => v.order = n); this.render(); };
      action('Move up', () => move(-1), row); action('Move down', () => move(1), row);
      action('Remove item', () => { this.value.items.splice(index, 1); this.value.items.forEach((v, n) => v.order = n); this.render(); }, row);
    });
    action('Add photo item', () => { if (this.value.items.length >= 100) return;
      this.value.items.push({ id: crypto.randomUUID(), label: '', enabled: true, minimum: 1, instruction: '', stage: 'NONE', framing: 'NORMAL', order: this.value.items.length }); this.render(); });
    action('Make every requirement optional', () => { this.value.total.enabled = false; this.value.items.forEach(i => i.enabled = false); this.render(); });
    node('p', 'One photo satisfies one selected item and counts once toward the total. Inspectors choose any order.').className = 'muted';
    if (!this.manageTemplates) { updateSummary(); return; }
    const manage = node('details'); node('summary', 'Save or manage templates', manage);
    const selected = suggested.find(t => t.id === this.selectedId);
    const name = input('Template name', 'text', selected?.name || '', () => {}, manage); name.maxLength = 100;
    const scope=select('Template available to', [['','All companies in this organization'],
      ...(this.companyId ? [[this.companyId,'This job company']] : [])],
      selected?.company_id||'', () => {}, manage);
    const description=input('Template description', 'text', selected?.description||'', () => {}, manage);
    description.maxLength=2000;
    const instructionsLabel=node('label','Template instructions (copied into editable work-order instructions)',manage);
    const templateInstructions=node('textarea','',instructionsLabel);templateInstructions.rows=3;
    templateInstructions.maxLength=4000;templateInstructions.value=selected?.instructions||'';
    templateInstructions.disabled=this.locked;
    const makeDefault = input('Default for this work type', 'checkbox', selected?.is_default || false, () => {}, manage);
    const status = node('p', '', manage); status.setAttribute('role', 'status');
    const save = async (asNew, active = true) => {
      const epoch=this.fetchEpoch, token=accessToken, companyAtOpen=this.companyId;
      try {
        PhotoRules.validate(this.value);
        const company=scope.value||null;
        if (!asNew && selected && (selected.company_id||null)!==company)
          throw Error('Use Save as new template to change company availability.');
        if (company && company!==companyAtOpen)
          throw Error('Open an authorized job for this company before saving.');
        status.textContent = 'Saving template…';
        const response = await adminFetch(`${SUPABASE_URL}/rest/v1/rpc/admin_save_company_photo_template`, {
          method: 'POST', headers: authHeaders(true), body: JSON.stringify({
          p_id: !asNew && selected ? selected.id : crypto.randomUUID(),
          p_name:name.value.trim(),p_work_type:this.getWorkType().trim(),
          p_requirements:this.snapshot(),p_active:active,p_is_default:makeDefault.checked,
          p_expected_revision: !asNew && selected ? selected.revision : null,
          p_company_id:company,p_description:description.value,p_instructions:templateInstructions.value
        }) });
        if (epoch!==this.fetchEpoch || token!==accessToken || companyAtOpen!==this.companyId) return;
        if (!response.ok) throw Error(await readableError(response, 'Unable to save template.'));
        const saved = await response.json();
        if (epoch!==this.fetchEpoch || token!==accessToken || companyAtOpen!==this.companyId) return;
        this.selectedId = active ? saved.id : ''; await this.reloadTemplates();
      } catch (e) {
        if (epoch===this.fetchEpoch && token===accessToken && companyAtOpen===this.companyId)
          status.textContent = e.message;
      }
    };
    action(selected ? 'Update template' : 'Save template', () => save(false), manage);
    if (selected) { action('Save as new template', () => save(true), manage); action('Archive template', () => save(false, false), manage); }
    updateSummary();
  }
}
