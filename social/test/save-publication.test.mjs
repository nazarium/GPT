import test from 'node:test';
import assert from 'node:assert/strict';
import {database,raw} from './helpers.mjs';
import {normalizeCatalog,fingerprint,buildPost} from '../catalog.mjs';
import {syncCatalog,first,run,claim,releaseProjects} from '../store.mjs';
import {socialAdmin,dispatchOne} from '../engine.mjs';
import {defaults,validateSettings,applyCaption} from '../settings.mjs';
const mapping=[{platform:'instagram',id:'ig',mode:'automatic'}];
test('saving persists the complete editor without Buffer calls, revokes readiness and survives preview reload',async()=>{
 const db=database(),project=normalizeCatalog([raw()])[0];await syncCatalog(db,[project],1);
 const settings={...defaults(),archiveEnabled:false};
 await run(db,"INSERT INTO social_meta(key,value) VALUES('settings',?)",JSON.stringify(settings));
 await run(db,"UPDATE social_meta SET value='1' WHERE key='live'");
 await run(db,'UPDATE social_projects SET ready_hash=fingerprint');
 await releaseProjects(db,null,2,mapping,settings);
 const env={SOCIAL_DB:db,SOCIAL_MODE:'live',BUFFER_CHANNELS:JSON.stringify(mapping),BUFFER_API_KEY:'test'};
 const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw new Error('No network while saving');};
 const input={id:project.id,fingerprint:await fingerprint(project),settingsRevision:0,savedAt:null,selection:{instagram:[0]},captions:{instagram:'Окремий опис'},options:{title:'Збережена назва',composeTitle:true,useCommonCaption:true,commonCaption:'Спільний опис',useCommonTags:true,commonTags:'#архітектура',platformTags:{instagram:'#особисті'},dueAt:'2026-11-20T08:00:00.000Z'}};
 const save=body=>socialAdmin(new Request('https://example.com/api/admin/social/save',{method:'POST',body:JSON.stringify(body)}),env,async()=>[raw()],{waitUntil:()=>assert.fail('save must not start a queue')});
 try {
  const response=await save(input);assert.equal(response.status,200);const result=await response.json();assert.equal(result.bufferMutations,0);
  const row=await first(db,'SELECT * FROM social_projects');assert.equal(row.ready_hash,null);assert.equal(row.saved_at,result.savedAt);assert.deepEqual(JSON.parse(row.options),input.options);assert.deepEqual(JSON.parse(row.captions),input.captions);assert.deepEqual(JSON.parse(row.selection),input.selection);
  assert.equal(await claim(db,project.id,'instagram','stale-claim',{},3),false);
  assert.equal((await dispatchOne(env,async()=>[raw()],4)).mode,'idle');
  const preview=await (await socialAdmin(new Request('https://example.com/api/admin/social/preview?id='+project.id),env,async()=>[raw()])).json();assert.equal(preview.options.title,input.options.title);
  assert.equal((await save(input)).status,409); // concurrent stale save cannot overwrite
  assert.equal((await save({...input,savedAt:result.savedAt,options:{...input.options,title:'Оновлена назва'}})).status,200);
  assert.equal(requests,0);
 }finally{globalThis.fetch=original;db.close();}
});
test('save rejects stale catalog, missing date and in-flight work without overwriting editor',async()=>{
 const db=database(),project=normalizeCatalog([raw()])[0];await syncCatalog(db,[project],1);
 const env={SOCIAL_DB:db,BUFFER_CHANNELS:JSON.stringify(mapping)};
 const input={id:project.id,fingerprint:await fingerprint(project),settingsRevision:0,options:{dueAt:'2026-11-20T08:00:00Z'}};
 const save=body=>socialAdmin(new Request('https://example.com/api/admin/social/save',{method:'POST',body:JSON.stringify(body)}),env,async()=>[raw()]);
 assert.equal((await save({...input,fingerprint:'stale'})).status,400);
 assert.equal((await save({...input,options:{}})).status,400);
 await run(db,"INSERT INTO social_publications(project_id,platform,channel_id,state,next_attempt,updated_at) VALUES(?, 'instagram','ig','sending',0,0)",project.id);
 assert.equal((await save(input)).status,409);assert.equal((await first(db,'SELECT saved_at FROM social_projects')).saved_at,null);db.close();
});
test('default tags are validated, used by unspecialized projects, and explicit empty or own tags take precedence',()=>{
 const settings=validateSettings({...defaults(),defaultTags:'архітектура, #дизайн'}),project=normalizeCatalog([raw()])[0],plan=buildPost(project,mapping[0]);
 assert.ok(applyCaption(plan,project,settings).input.text.endsWith('#архітектура #дизайн'));
 assert.ok(!applyCaption(plan,project,settings,{}, {commonTags:''}).input.text.includes('#'));
 assert.ok(applyCaption(plan,project,settings,{}, {useCommonTags:false,platformTags:{instagram:'власні'}}).input.text.endsWith('#власні'));
 assert.throws(()=>validateSettings({...defaults(),defaultTags:42}),/текстом/);
});
