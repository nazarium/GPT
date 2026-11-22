import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const source=read('Integration.gs')+'\n'+read('Dialog.gs')+'\n'+read('Runtime.gs');
function harness(overrides={}){
 const c=vm.createContext({console,...overrides});vm.runInContext(source,c);
 const ctx={actor:'123',chat:'123',username:'tester',now:'2026-11-18T20:00:00.000Z',suppliers:[],offers:[],materials:[]};
 let state=null,id=100,result;
 const send=(event)=>{result=c.acpReducer_(state,{id:++id,...event},ctx);state=result.state;return result;};
 const click=action=>{const i=state.buttons.findIndex(b=>b[1]===action);assert.ok(i>=0,'Missing button '+action+' at '+state.step);return send({callback:'b:'+state.version+':'+i});};
 return {c,ctx,send,click,get state(){return state;},get result(){return result;}};
}
function basic(h){h.send({text:'Подати пропозицію'});h.send({text:'Компанія'});h.send({text:'contact@example.invalid'});}
function addExisting(h){
 h.ctx.suppliers=[{supplier_id:'s1',telegram_user_id:'123',telegram_chat_id:'123',telegram_username:'tester',company_name:'Existing',contact:'old',categories:'old category',brands:'',regions:'',terms:'',drive_folder_id:'folder',status:'active',created_at:'old',updated_at:'old',confirmed_at:''}];
 h.ctx.offers=[{offer_id:'o1',supplier_id:'s1',text:'Old text',status:'active',created_at:'old',updated_at:'old'}];
 h.ctx.materials=[{material_id:'m1',offer_id:'o1',kind:'file',original_name:'old.pdf',drive_file_id:'file1',source_url:'',status:'active',created_at:'old',updated_at:'old'}];
}
test('original greeting matches the approved document exactly',()=>{
 const h=harness();const doc=read('../STAGE-2-BOT-SCENARIO.md');
 const greeting=doc.match(/> \*\*Вітаємо[\s\S]*?> Реєстрація не гарантує замовлень чи особистої зустрічі\./)[0].replace(/^> ?/gm,'').replace(/\*\*/g,'');
 assert.equal(h.c.ACP_GREETING,greeting);
 const r=h.send({text:'/start'});assert.deepEqual(JSON.parse(JSON.stringify(r.reply.markup.keyboard)).flat().map(x=>x.text),['Подати пропозицію','Оновити матеріали']);
});
test('minimal text proposal can be saved without optional fields',()=>{
 const h=harness();basic(h);h.send({text:'Наші матеріали'});h.click('done');const r=h.click('save');
 assert.equal(r.effect.type,'offer');assert.equal(r.effect.draft.newCompany,true);assert.equal(r.effect.draft.supplier.contact,'contact@example.invalid');assert.equal(r.effect.draft.supplier.categories,'');
});
test('Telegram start parameter opens the normal greeting',()=>{
 const h=harness();assert.equal(h.send({text:'/start acp_test_7f29c1'}).reply.text,h.c.ACP_GREETING);
});
test('file-only and link-only proposals are independently sufficient',()=>{
 for(const input of [{document:{file_id:'abc',file_size:100,file_name:'catalog.pdf'}},{text:'https://example.invalid/catalog'}]){
  const h=harness();basic(h);h.send(input);h.click('done');assert.equal(h.click('save').effect.type,'offer');
 }
});
test('empty proposal cannot advance and a large file is not counted',()=>{
 const h=harness();basic(h);h.click('done');assert.equal(h.state.step,'materials');
 h.send({document:{file_id:'big',file_size:20000001,file_name:'big.pdf'}});assert.equal(h.state.draft.materials.length,0);h.click('done');assert.equal(h.state.step,'materials');
});
test('cancel confirmation preserves draft and discard does not save',()=>{
 const h=harness();basic(h);h.send({text:'Draft'});h.click('cancel');assert.equal(h.state.step,'interrupt');h.click('resume');assert.equal(h.state.draft.text,'Draft');h.click('cancel');const r=h.click('discard');assert.equal(r.effect,null);assert.equal(h.state.draft,null);
});
test('repeated navigation does not recursively nest drafts',()=>{
 const h=harness();basic(h);for(let i=0;i<20;i++)h.send({text:'/start'});
 assert.ok(JSON.stringify(h.state).length<2500);h.click('resume');assert.equal(h.state.step,'materials');
});
test('obsolete callbacks cannot save twice',()=>{
 const h=harness();basic(h);h.send({text:'hello'});h.click('done');const old='b:'+h.state.version+':0';h.click('save');assert.equal(h.send({callback:old}).effect,null);
});
test('unexpected text during resume prompt does not invalidate the Continue button',()=>{
 const h=harness();basic(h);h.click('cancel');
 const callback='b:'+h.state.version+':0';
 h.send({text:'Premature company name'});const r=h.send({callback});assert.equal(r.state.step,'materials');
});
test('stale callbacks reissue the current keyboard and typed Continue is accepted',()=>{
 const h=harness();h.send({text:'Подати пропозицію'});h.send({text:'Подати пропозицію'});
 const r=h.send({callback:'b:obsolete:0'});assert.ok(r.reply.markup.inline_keyboard.length);
 h.send({text:'Продовжити'});assert.equal(h.state.step,'name');h.send({text:'Компанія'});assert.equal(h.state.step,'contact');
});
test('retrying private test recovery preserves an already active draft',()=>{
 const h=harness();let runs=0;
 h.c.acpRequireOwner_=()=>{};h.c.partnersWithLock_=fn=>fn();
 h.c.PropertiesService={getScriptProperties:()=>({getProperty:()=> '123'})};
 h.c.acpRows_=()=>[{actor_id:'123',state_json:JSON.stringify({step:'contact',draft:{supplier:{company_name:'Keep company'}}})}];
 h.c.runPrivateTestWindow=()=>runs++;
 h.c.acpPut_=()=>{throw Error('Unexpected rewrite');};
 h.c.resumePrivateTestDraft();assert.equal(runs,1);
});
test('optional fields are editable and skippable',()=>{
 const h=harness();basic(h);h.send({text:'hello'});h.click('done');h.click('extras');h.click('field');h.click('fieldSkip');h.click('fieldsDone');assert.equal(h.click('save').effect.draft.supplier.categories,'');
});
test('one actor submits directly for the bound company',()=>{
 const h=harness();addExisting(h);h.send({text:'Подати пропозицію'});assert.equal(h.state.step,'materials');assert.equal(h.state.draft.newCompany,false);assert.ok(!h.state.buttons.some(b=>b[1]==='otherCompany'));h.send({text:'Proposal'});h.click('done');assert.equal(h.click('save').effect.draft.supplier.supplier_id,'s1');
});
test('legacy company buttons cannot create a second company',()=>{
 const h=harness();addExisting(h);const r=h.c.acpReducer_({step:'companies',version:'1',buttons:[['Other','otherCompany']]},{id:2,callback:'b:1:0'},h.ctx);assert.equal(r.state.draft.supplier.supplier_id,'s1');assert.equal(r.state.draft.newCompany,false);
});
test('multiple legacy bindings require review instead of silently selecting a company',()=>{
 const h=harness();addExisting(h);h.ctx.suppliers.push({...h.ctx.suppliers[0],supplier_id:'s2'});assert.throws(()=>h.send({text:'Подати пропозицію'}),/MULTIPLE_COMPANIES/);
});
test('editing contacts has no proposal or material effect',()=>{
 const h=harness();addExisting(h);h.send({text:'Оновити матеріали'});h.click('profile');
 const idx=h.state.buttons.findIndex(b=>b[2]==='contact');h.send({callback:'b:'+h.state.version+':'+idx});h.send({text:'new contact'});h.click('fieldsDone');const r=h.click('saveProfile');assert.equal(r.effect.type,'profile');assert.equal(r.effect.supplier.contact,'new contact');assert.equal(h.ctx.offers[0].text,'Old text');
});
test('replacing a material stays in draft until Save',()=>{
 const h=harness();addExisting(h);h.send({text:'Оновити матеріали'});h.click('offers');h.click('offer');h.click('replace');h.click('material');h.send({document:{file_id:'new',file_size:100,file_name:'new.pdf'}});
 assert.equal(h.ctx.materials[0].drive_file_id,'file1');assert.equal(h.state.draft.materials[0].original_name,'new.pdf');assert.equal(h.result.effect,null);assert.equal(h.click('save').effect.type,'offer');
});
test('cannot remove the only content of a proposal',()=>{
 const h=harness();addExisting(h);h.ctx.offers[0].text='';h.send({text:'Оновити матеріали'});h.click('offers');h.click('offer');h.click('remove');h.click('material');h.click('removeYes');assert.equal(h.state.draft.materials.length,1);
});
test('another actor cannot access a supplier even with a forged valid-session button',()=>{
 const h=harness();addExisting(h);h.ctx.actor='456';
 assert.throws(()=>h.c.acpReducer_({step:'companies',version:'1',buttons:[['Company','company','s1']]},{id:2,callback:'b:1:0'},h.ctx),/NOT_ACCESSIBLE/);
});
test('runtime ignores group updates and actors outside test allowlist',()=>{
 const h=harness();let reads=0;h.c.acpRows_=()=>{reads++;return [];};
 h.c.acpHandle_({update_id:1,message:{from:{id:456},chat:{id:456,type:'private'},text:'/start'}},'123');
 h.c.acpHandle_({update_id:2,message:{from:{id:123},chat:{id:-100,type:'group'},text:'/start'}},'123');assert.equal(reads,0);
});
test('journal retry restores a session after a storage failure without duplicating its reply',()=>{
 const h=harness();const tables={'_Sessions':[],'_Outbox':[],'_Updates':[]};let fail=true,commits=0;
 h.c.acpPut_=(name,row)=>{if(name==='_Sessions'&&fail){fail=false;throw Error('storage unavailable');}const i=tables[name].findIndex(x=>String(x[Object.keys(row)[0]])===String(row[Object.keys(row)[0]]));if(i<0)tables[name].push(JSON.parse(JSON.stringify(row)));else tables[name][i]=JSON.parse(JSON.stringify(row));};
 h.c.acpCommit_=()=>{commits++;};
 const row={update_id:'1',actor_id:'123',chat_id:'123',phase:'planned',updated_at:'now',plan_json:JSON.stringify({effect:{type:'profile'},state:{step:'home'},before:{step:'profileReview'},now:'now',reply:{text:'Saved',markup:{}}})};
 assert.throws(()=>h.c.acpApply_(row),/unavailable/);h.c.acpApply_(row);h.c.acpApply_(row);assert.equal(tables._Outbox.length,1);assert.equal(row.phase,'applied');assert.equal(commits,2); // durable effects must support retry
});
test('failed download returns to review and never emits a success message',()=>{
 const h=harness();basic(h);h.send({document:{file_id:'a',file_size:100,file_name:'a.pdf'}});h.click('done');const before=JSON.parse(JSON.stringify(h.state)),plan=h.click('save');plan.before=before;plan.now='now';
 const saved={};h.c.acpCommit_=()=>{const e=Error('download failed');e.materialId=before.draft.materials[0].material_id;throw e;};h.c.acpPut_=(name,row)=>saved[name]=row;
 h.c.acpApply_({update_id:'1',actor_id:'123',chat_id:'123',phase:'planned',plan_json:JSON.stringify(plan)});
 assert.match(saved._Outbox.text,/Не вдалося/);assert.equal(JSON.parse(saved._Sessions.state_json).step,'review');
});
