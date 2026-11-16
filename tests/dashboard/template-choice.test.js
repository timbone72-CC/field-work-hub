'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require.resolve('../../dashboard/photo-requirements.js'),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const requirements=n=>({schema:1,revision:id(n),total:{enabled:false,minimum:0},items:[]});
function rig(){
 const context=vm.createContext({crypto:webcrypto,structuredClone});
 const Editor=vm.runInContext(source+'\nPhotoRequirementEditor;',context);
 let workType='Before',allow=false,instructions='Keep unfinished instructions';
 const before=requirements(1),next=requirements(2);
 const editor=Object.assign(Object.create(Editor.prototype),{
  locked:false,companyId:null,selectedId:'',value:before,
  templates:[{id:id(3),name:'Next default',active:true,is_default:true,work_type:'Next',requirements:next,instructions:'Template instructions'}],
  getWorkType:()=>workType,
  onTemplateApplied:t=>{if(!allow)return false;instructions=t.instructions;return true;},
  render(){this.renderedOptions=this.applicable().map(t=>t.id);this.renderedSelection=this.selectedId;}
 });
 editor.render();
 return {editor,before,next,setType:v=>{workType=v;},allow:()=>{allow=true;},instructions:()=>instructions};
}
test('declining default instructions after changing work type refreshes available templates and retains the draft',()=>{
 const x=rig();x.setType('Next');x.editor.useDefault();
 assert.deepEqual(Array.from(x.editor.renderedOptions),[id(3)],'New work-type template must remain selectable after Cancel');
 assert.equal(x.editor.renderedSelection,'');
 assert.equal(x.instructions(),'Keep unfinished instructions');
 assert.equal(x.editor.value,x.before,'Cancel must retain the exact requirement draft/revision');
});
test('declining an explicit template restores the displayed selection to the unapplied draft',()=>{
 const x=rig();x.setType('Next');x.editor.refreshSuggestions();
 // Native select has already changed before its change listener requests confirmation.
 x.editor.renderedSelection=id(3);x.editor.choose(id(3));
 assert.equal(x.editor.renderedSelection,'','Cancelled choice must not claim the new template was applied');
 assert.equal(x.editor.selectedId,'');assert.equal(x.editor.value,x.before);
 assert.equal(x.instructions(),'Keep unfinished instructions');
});
test('accepting a template still copies its requirements with a new revision',()=>{
 const x=rig();x.setType('Next');x.allow();x.editor.choose(id(3));
 assert.equal(x.editor.renderedSelection,id(3));
 assert.equal(x.instructions(),'Template instructions');
 assert.notEqual(x.editor.value,x.next);assert.notEqual(x.editor.value.revision,x.next.revision);
 assert.equal(x.next.revision,id(2));
});
