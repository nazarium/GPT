import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function setup(){
 const folders=[],iter=items=>{let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};};
 const root={getId:()=> 'root',getFolders:()=>iter(folders),getFoldersByName:n=>iter(folders.filter(f=>f.getName()===n)),createFolder:n=>{let name=n,description='';const id='folder'+folders.length,f={getId:()=>id,getName:()=>name,setName:n=>name=n,getDescription:()=>description,setDescription:d=>description=d,getParents:()=>iter([root])};folders.push(f);return f;}};
 const c=vm.createContext({console,DriveApp:{getFolderById:id=>folders.find(f=>f.getId()===id)},Utilities:{formatDate:()=> '2026-11-22'}});
 vm.runInContext(['Integration.gs','Dialog.gs','Runtime.gs'].map(n=>readFileSync(new URL(n,import.meta.url),'utf8')).join('\n'),c);c.acpPrivateFolder_=()=>{};
 return {c,root,folders};
}
test('existing folder is renamed to company without changing its ID',()=>{
 const h=setup(),f=h.root.createFolder('s1');h.c.acpSupplierFolder_(h.root,{supplier_id:'s1',company_name:'Company',drive_folder_id:f.getId()});assert.equal(f.getName(),'Company');assert.equal(h.folders.length,1);
});
test('same company names use date and a counter for another collision that day',()=>{
 const h=setup();for(let i=1;i<=3;i++)h.c.acpSupplierFolder_(h.root,{supplier_id:'s'+i,company_name:'Company'});
 assert.deepEqual(h.folders.map(f=>f.getName()),['Company','Company — 2026-11-22','Company — 2026-11-22 — 2']);
});
test('retry before Sheets checkpoint finds the marked company folder',()=>{
 const h=setup(),p={supplier_id:'s1',company_name:'Company'};const first=h.c.acpSupplierFolder_(h.root,p);const retry=h.c.acpSupplierFolder_(h.root,p);assert.equal(first.getId(),retry.getId());assert.equal(h.folders.length,1);
});
test('dated folder stays stable and company rename follows its new name',()=>{
 const h=setup();h.root.createFolder('Company');const p={supplier_id:'s1',company_name:'Company'},f=h.c.acpSupplierFolder_(h.root,p);p.drive_folder_id=f.getId();h.c.acpSupplierFolder_(h.root,p);assert.equal(f.getName(),'Company — 2026-11-22');p.company_name='Renamed';h.c.acpSupplierFolder_(h.root,p);assert.equal(f.getName(),'Renamed');
});
test('offer text export updates the same file and recovers a missing description',()=>{
 const {c}=setup(),files=[];c.MimeType={PLAIN_TEXT:'text/plain'};
 const iter=items=>{let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};};
 const folder={getFiles:()=>iter(files),getFilesByName:name=>iter(files.filter(f=>f.name===name)),createFile:(name,content)=>{const f={name,content,description:'',getDescription(){return this.description;},setDescription(d){this.description=d;},setContent(t){this.content=t;}};files.push(f);return f;}};
 c.acpOfferTextFile_(folder,'o1','Початковий текст');assert.equal(files.length,1);assert.equal(files[0].content,'Початковий текст');
 c.acpOfferTextFile_(folder,'o1','Оновлено');assert.equal(files.length,1);assert.equal(files[0].content,'Оновлено');
 files[0].description='';c.acpOfferTextFile_(folder,'o1','Повтор');assert.equal(files.length,1);assert.equal(files[0].description,'partners-offer-text:o1');
 c.acpOfferTextFile_(folder,'o2','');assert.equal(files.length,1);
 c.acpOfferTextFile_(folder,'o1','');assert.match(files[0].content,/очищено/);
});
