'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const rules=require('../../dashboard/job-workspace.js');
const source=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
const start=source.indexOf('  function addressContext() {');
const end=source.indexOf('  async function loadAddressContext(',start);
assert.ok(start>0&&end>start,'Existing address context must remain present');
const code=source.slice(start,end);
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');

function rig() {
 const selected={id:uid(1),organization_id:uid(10),client_company_id:uid(20),
   property_address:'123 Main St',wo_number:'WO-1'};
 const sibling={...selected,id:uid(2),wo_number:'WO-2'};
 const list={children:[],replaceChildren(){this.children=[];},append(b){this.children.push(b);},
   contains(b){return this.children.includes(b);}};
 const document={
   activeElement:null,
   createElement(){return {dataset:{},disabled:false,setAttribute(){},addEventListener(){},
     focus(){document.activeElement=this;}};}
 };
 const fallback={focus(){document.activeElement=this;}};
 const fields={'job-address-work-orders':list,'job-address-context':{hidden:false},
   'job-address-status':{textContent:''},'job-address-next':{disabled:false},
   'job-address-previous':{disabled:false},'job-address-load':fallback};
 const ctx={document,el:id=>fields[id],JobAddressContext:rules.JobAddressContext,
   selectedRow:selected,addressRows:[selected,sibling],addressTotal:2,addressOffset:0,choose(){}};
 vm.createContext(ctx);vm.runInContext(code+';globalThis.paint=addressContext;',ctx);
 return {ctx,document,list,selected,sibling,fallback};
}
test('repainting address links keeps keyboard focus on exactly the same UUID',()=>{
 const h=rig();h.ctx.paint();
 const old=h.list.children.find(b=>b.dataset.addressOpenId===h.sibling.id);
 old.focus();h.ctx.paint();
 assert.notEqual(h.document.activeElement,old);
 assert.equal(h.document.activeElement.dataset.addressOpenId,h.sibling.id);
 assert.equal(h.document.activeElement.disabled,false);
});
test('focused address WO leaving the results moves focus to safe address-load control',()=>{
 const h=rig();h.ctx.paint();
 h.list.children.find(b=>b.dataset.addressOpenId===h.sibling.id).focus();
 h.ctx.addressRows=[h.selected];h.ctx.addressTotal=1;h.ctx.paint();
 assert.equal(h.document.activeElement,h.fallback);
 assert.deepEqual(h.list.children.map(b=>b.dataset.addressOpenId),[h.selected.id]);
});
test('refresh of sibling links does not steal focus from an editor field',()=>{
 const h=rig();h.ctx.paint();
 const editing={};h.document.activeElement=editing;h.ctx.paint();
 assert.equal(h.document.activeElement,editing);
});
test('table focus restoration follows WO UUID, never row index',()=>{
 const app=fs.readFileSync(require.resolve('../../dashboard/app.js'),'utf8');
 const begin=app.indexOf('function renderWorkOrders(rows, organizationId) {');
 const end=app.indexOf('function openEditor(',begin);
 assert.ok(begin>0&&end>begin);
 const section=app.slice(begin,end);
 assert.match(section,/workOrders\.contains\(focused\)/);
 assert.match(section,/button=>button\.dataset\.jobOpenId===focusedWorkOrderId/);
 assert.match(section,/match\.focus\(\{preventScroll:true\}\)/);
 assert.match(section,/getElementById\('job-search'\)\?\.focus/);
});
