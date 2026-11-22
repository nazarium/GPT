import test from 'node:test';
import assert from 'node:assert/strict';
import {database,raw,imageResponse} from './helpers.mjs';
import {normalizeCatalog,fingerprint} from '../catalog.mjs';
import {syncCatalog,all,run} from '../store.mjs';
import {defaults} from '../settings.mjs';
import {preflightProject} from '../preflight.mjs';
import {socialAdmin} from '../engine.mjs';
const mapping=[{platform:'instagram',id:'ig',mode:'automatic'},{platform:'facebook',id:'fb',mode:'automatic'},{platform:'tiktok',id:'tt',mode:'notification'}];
async function setup(rawProject=raw()) {
 const db=database(),p=normalizeCatalog([rawProject])[0];await syncCatalog(db,[p],1);
 const settings=defaults(),env={SOCIAL_DB:db,BUFFER_CHANNELS:JSON.stringify(mapping)};
 const input={id:p.id,fingerprint:await fingerprint(p),settingsRevision:0,selection:{},captions:{},options:{title:'Назва',composeTitle:true,useCommonCaption:true,commonCaption:'Спільний опис',commonTags:'#архітектура'}};
 return {db,p,settings,env,input,catalog:async()=>[rawProject]};
}
test('preflight uses unsaved title, captions, tags and selections, checks originals once, and makes no Buffer calls or DB writes',async()=>{
 const {db,p,env,input,settings,catalog}=await setup();let requests=0;
 const before=JSON.stringify(await all(db,'SELECT * FROM social_projects'));
 const result=await preflightProject(input,env,settings,catalog,async url=>{assert.ok(String(url).startsWith('https://archi-create.com.ua/'));requests++;return imageResponse();});
 assert.equal(result.ready,true);assert.equal(result.plans.length,3);assert.ok(requests<=2);assert.deepEqual(result.issues,[]);
 assert.equal(JSON.stringify(await all(db,'SELECT * FROM social_projects')),before);assert.equal((await all(db,'SELECT * FROM social_publications')).length,0);
 const tooLong=await preflightProject({...input,options:{...input.options,commonCaption:'x'.repeat(2190),commonTags:'#довгийтег'}},env,settings,catalog);
 assert.equal(tooLong.ready,false);assert.equal(tooLong.issues[0].platform,'instagram');
 const noPhoto=await preflightProject({...input,selection:{facebook:[]}},env,settings,catalog,async()=>imageResponse());assert.ok(noPhoto.issues.some(i=>i.platform==='facebook'));db.close();
});
test('default first-ten selection passes preflight; explicit oversized selections are blocked',async()=>{
 const item={...raw(),images:Array.from({length:11},(_,i)=>`assets/projects/123/${i}.png`)};
 const {db,env,input,settings,catalog}=await setup(item);
 const result=await preflightProject(input,env,settings,catalog,async()=>imageResponse());
 assert.equal(result.ready,true);assert.deepEqual(result.plans.map(plan=>plan.photoCount),[11,10,10]);
 const oversized={facebook:item.images.map((_,i)=>i),tiktok:item.images.map((_,i)=>i)};
 const invalid=await preflightProject({...input,selection:oversized},env,settings,catalog,async()=>imageResponse());
 assert.equal(invalid.ready,false);assert.deepEqual([...new Set(invalid.issues.map(i=>i.platform))],['facebook','tiktok']);
 const selection={facebook:[0,1],tiktok:[0,1]};assert.equal((await preflightProject({...input,selection},env,settings,catalog,async()=>imageResponse())).ready,true);db.close();
});
test('hidden, changed, stale settings and in-flight work are blocked before mass delivery',async()=>{
 const {db,p,env,input,settings,catalog}=await setup();
 assert.equal((await preflightProject({...input,fingerprint:'stale'},env,settings,catalog)).ready,false);
 assert.equal((await preflightProject({...input,settingsRevision:2},env,settings,catalog)).ready,false);
 await run(db,"INSERT INTO social_publications(project_id,platform,channel_id,state,next_attempt,updated_at) VALUES(?,'instagram','ig','uncertain',0,0)",p.id);
 const r=await preflightProject(input,env,{...settings,allowRepeatDrafts:true},catalog,async()=>imageResponse());assert.ok(r.issues.some(i=>i.platform==='instagram'&&i.reason.includes('невідомий')));
 await run(db,'UPDATE social_projects SET active=0');assert.equal((await preflightProject(input,env,settings,catalog)).ready,false);db.close();
});
test('preflight endpoint is a read-only preview and preserves pause state',async()=>{
 const {db,env,input,catalog}=await setup(),original=globalThis.fetch;
 globalThis.fetch=async url=>{assert.ok(String(url).includes('archi-create.com.ua'));return imageResponse();};
 try {
  const r=await socialAdmin(new Request('https://example.com/api/admin/social/preflight',{method:'POST',body:JSON.stringify(input)}),env,catalog,{waitUntil:()=>assert.fail('must not dispatch')});
  assert.equal(r.status,200);assert.equal((await r.json()).ready,true);assert.equal((await all(db,"SELECT value FROM social_meta WHERE key='live'"))[0].value,'0');
 }finally{globalThis.fetch=original;db.close();}
});
