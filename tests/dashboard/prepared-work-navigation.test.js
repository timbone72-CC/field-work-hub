'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const PhotoRules=require('../../dashboard/photo-requirements.js');
const nav=fs.readFileSync(require.resolve('../../dashboard/navigation.js'),'utf8');
const app=fs.readFileSync(require.resolve('../../dashboard/app.js'),'utf8');
const begin=app.indexOf('function prepareWorkFromSelectedJob(copyPriorDetails) {');
const end=app.indexOf("document.getElementById('prepare-repeat-work')",begin);
assert.ok(begin>0&&end>begin);
function rig(accept=true){
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',dataset:{},open:false,hidden:false,events:new Map(),
  addEventListener(type,fn){this.events.set(type,fn);},dispatchEvent(e){this.events.get(e.type)?.(e);},
  setAttribute(){},removeAttribute(){},focus(){}});return nodes.get(id);};
 const links=['home','work','create','alerts','team'].map(v=>Object.assign(node('link-'+v),{dataset:{fwhGo:v}}));
 const root=node('results-card');root.querySelectorAll=()=>links;root.querySelector=()=>null;
 const fields={woNumberInput:node('wo-number'),propertyAddressInput:node('property-address'),
  workTypeInput:node('work-type'),instructionsInput:node('instructions'),dueDateInput:node('due-date'),assigneeSelect:node('assignee')};
 fields.instructionsInput.value='Retained unfinished draft';
 const snapshot=PhotoRules.empty();snapshot.total={enabled:true,minimum:1};
 const old={id:'old-work',property_address:'Old TEST address',work_type:'TEST',instructions:'Prior instructions',run:{requirement_snapshot:snapshot}};
 let pending,confirmations=0;
 const ctx={...fields,Event:class{constructor(type){this.type=type;}},document:{getElementById:node},
  MutationObserver:class{observe(){}},window:{confirm(){confirmations++;return accept;}},
  currentUser:{id:'actor',app_metadata:{organization_id:'org'}},adminSessionEpoch:1,accessToken:'token',
  editWorkOrderIdInput:{value:old.id},JobWorkspace:{dirty:()=>false,guard:fn=>{pending=fn();}},
  PhotoRules,fetchWorkOrder:async()=>old,
  createPhotos:{value:PhotoRules.empty(),load(v){this.value=v||PhotoRules.empty();}},
  createForm:{reset(){for(const field of Object.values(fields))field.value='';}},
  rememberWoNumberMode:{checked:true},applyWoNumberMode(){},fillWorkTypes(){},
  closeEditor(){},setCreateStatus(){},setEditStatus(message){throw Error(message);}};
 vm.createContext(ctx);vm.runInContext(nav,ctx);vm.runInContext(app.slice(begin,end),ctx);
 // Native details was opened earlier. Returning to Work Orders keeps it open;
 // setting .open=true again emits no new toggle event.
 node('create-wo-details').open=true;root.dataset.fwhView='work';
 return {ctx,root,node,fields,old,confirmations:()=>confirmations,
  async prepare(copy){ctx.prepareWorkFromSelectedJob(copy);await pending;}};
}
test('repeat work reveals an already-open Create panel and retains the copied draft',async()=>{
 const x=rig();await x.prepare(true);
 assert.equal(x.root.dataset.fwhView,'create','Successful preparation must visibly navigate to its draft');
 assert.equal(x.fields.propertyAddressInput.value,x.old.property_address);
 assert.equal(x.fields.instructionsInput.value,x.old.instructions);
 assert.equal(x.fields.dueDateInput.value,'');assert.equal(x.fields.assigneeSelect.value,'');
 assert.equal(x.ctx.createPhotos.value.total.minimum,1);
});
test('custom work also reveals the reused Create panel without old requirements',async()=>{
 const x=rig();await x.prepare(false);
 assert.equal(x.root.dataset.fwhView,'create');
 assert.equal(x.fields.propertyAddressInput.value,x.old.property_address);
 assert.equal(x.fields.workTypeInput.value,'');assert.equal(x.fields.instructionsInput.value,'');
 assert.equal(x.ctx.createPhotos.value.total.enabled,false);
});
test('declining draft replacement keeps Work Orders and unfinished input unchanged',async()=>{
 const x=rig(false);await x.prepare(true);
 assert.equal(x.root.dataset.fwhView,'work');
 assert.equal(x.fields.instructionsInput.value,'Retained unfinished draft');
 assert.equal(x.confirmations(),1);
});
