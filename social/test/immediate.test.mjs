import test from 'node:test';
import assert from 'node:assert/strict';
import {database,raw,channel,imageResponse} from './helpers.mjs';
import {defaults} from '../settings.mjs';
import {normalizeCatalog,fingerprint} from '../catalog.mjs';
import {syncCatalog,markReady,releaseProjects,first,run,all} from '../store.mjs';
import {socialAdmin,kickImmediate,tick} from '../engine.mjs';

async function setup(archiveEnabled=false) {
 const db=database(),catalog=[raw()],p=normalizeCatalog(catalog)[0];
 await syncCatalog(db,[p],1);
 const settings={...defaults(),archiveEnabled};
 await run(db,"INSERT INTO social_meta(key,value) VALUES('settings',?)",JSON.stringify(settings));
 await run(db,"INSERT INTO social_meta(key,value) VALUES('channels',?)",await fingerprint([channel]));
 const env={SOCIAL_DB:db,SOCIAL_MODE:'live',BUFFER_API_KEY:'test-only',BUFFER_ORGANIZATION_ID:'org',BUFFER_CHANNELS:JSON.stringify([channel])};
 return {db,catalog,p,env,settings};
}
function mockBuffer() {
 const original=globalThis.fetch,inputs=[];
 globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('https://archi-create.com.ua'))return imageResponse();
  const body=JSON.parse(init.body);
  if(body.query.includes('query Channels'))return Response.json({data:{channels:[{...channel,service:'instagram',type:'business',isDisconnected:false,isLocked:false,isQueuePaused:false}]}});
  if(body.query.includes('mutation CreatePost')) {
   inputs.push(body.variables.input);
   return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'draft-'+inputs.length,status:'draft',schedulingType:'automatic'}}}});
  }
  throw new Error('Unexpected request '+body.query);
 };
 return {inputs,restore:()=>{globalThis.fetch=original;}};
}
const request=(action,body)=>new Request('https://example.com/api/admin/social/'+action,{method:'POST',body:JSON.stringify(body)});

test('disabled archive schedule releases all and only ready visible archives without a slot; existing drafts are skipped',async()=>{
 const db=database(),ps=normalizeCatalog([raw('123'),raw('124'),raw('125'),raw('126')]);
 await syncCatalog(db,ps,1);
 for(const p of [ps[0],ps[1],ps[3]])await markReady(db,p.id,await fingerprint(p),{},1);
 await run(db,"UPDATE social_projects SET active=0 WHERE id='126'");
 await run(db,"INSERT INTO social_drafts(project_id,platform,buffer_id,state,fingerprint,updated_at) VALUES('123','instagram','old','draft',?,1)",await fingerprint(ps[0]));
 await releaseProjects(db,null,2,[channel],{archiveEnabled:false});
 assert.deepEqual((await all(db,'SELECT project_id FROM social_publications')).map(p=>p.project_id),['124']);
 assert.equal((await first(db,"SELECT released_at FROM social_projects WHERE id='125'")).released_at,null);
 await releaseProjects(db,null,3,[channel],{archiveEnabled:false});
 assert.equal((await all(db,'SELECT * FROM social_publications')).length,1);db.close();
});

test('enabled archive schedule still waits for a slot',async()=>{
 const {db,p}=await setup(true);await markReady(db,p.id,await fingerprint(p),{},1);
 await releaseProjects(db,null,2,[channel],{archiveEnabled:true});
 assert.equal(await first(db,'SELECT * FROM social_publications'),null);db.close();
});

test('ready starts background draft transfer without waiting for Cron and does not duplicate it',async()=>{
 const {db,p,env,catalog}=await setup();await run(db,"UPDATE social_meta SET value='1' WHERE key='live'");
 const mock=mockBuffer(),tasks=[],ctx={waitUntil(p){tasks.push(p);}};
 try {
  const r=await socialAdmin(request('ready',{id:p.id,fingerprint:await fingerprint(p),settingsRevision:0}),env,async()=>catalog,ctx);
  assert.equal(r.status,200);assert.equal((await r.json()).processing,true);
  await Promise.all(tasks);
  assert.equal(mock.inputs.length,1);assert.equal(mock.inputs[0].saveToDraft,true);
  assert.equal((await first(db,'SELECT state FROM social_drafts')).state,'draft');
  await tick(env,async()=>catalog);assert.equal(mock.inputs.length,1);
 }finally{mock.restore();db.close();}
});

test('pause prevents an immediate transfer and resume restores draft delivery even with zero ready projects',async()=>{
 const {db,env,catalog}=await setup(),mock=mockBuffer(),tasks=[],ctx={waitUntil(p){tasks.push(p);}};
 try {
  assert.equal(await kickImmediate(env,async()=>catalog,ctx),false);assert.equal(tasks.length,0);
  const resumed=await socialAdmin(request('resume',{settingsRevision:0,confirm:'APPROVE_DRAFT_DELIVERY'}),env,async()=>catalog,ctx);
  assert.equal(resumed.status,200);assert.equal((await resumed.json()).mode,'live');
  await Promise.all(tasks);assert.equal(mock.inputs.length,0);
  const paused=await socialAdmin(request('pause',{}),env,async()=>catalog,ctx);
  assert.equal(paused.status,200);assert.equal((await first(db,"SELECT value FROM social_meta WHERE key='live'")).value,'0');
  assert.equal(await kickImmediate(env,async()=>catalog,ctx),false);
 }finally{mock.restore();db.close();}
});

test('resume rejects stale settings, dry-run, scheduling mode and missing prior activation',async()=>{
 const {db,env,catalog,settings}=await setup(),mock=mockBuffer();
 try {
  const call=(e,b)=>socialAdmin(request('resume',{settingsRevision:0,confirm:'APPROVE_DRAFT_DELIVERY',...b}),e,async()=>catalog);
  assert.equal((await call(env,{settingsRevision:1})).status,400);
  assert.equal((await call({...env,SOCIAL_MODE:'dry-run'})).status,400);
  await run(db,"UPDATE social_meta SET value=? WHERE key='settings'",JSON.stringify({...settings,deliveryMode:'schedule'}));
  assert.equal((await call(env,{})).status,400);
  await run(db,"UPDATE social_meta SET value=? WHERE key='settings'",JSON.stringify(settings));
  await run(db,"DELETE FROM social_meta WHERE key='channels'");
  assert.equal((await call(env,{})).status,400);
  assert.equal((await first(db,"SELECT value FROM social_meta WHERE key='live'")).value,'0');
  assert.equal(mock.inputs.length,0);
 }finally{mock.restore();db.close();}
});

test('resume starts a prepared queue once, creates drafts only and leaves save-only projects untouched',async()=>{
 const {db,env,catalog,p}=await setup(),second=raw('124','02'),items=[...catalog,second];
 await syncCatalog(db,normalizeCatalog(items),2);
 await run(db,"UPDATE social_projects SET saved_at=2,options=? WHERE id='124'",JSON.stringify({dueAt:'2026-11-20T08:00:00Z'}));
 await markReady(db,p.id,await fingerprint(p),{},2);
 const mock=mockBuffer(),tasks=[],ctx={waitUntil(task){tasks.push(task);}};
 try {
  assert.equal(await kickImmediate(env,async()=>items,ctx),false);
  const r=await socialAdmin(request('resume',{settingsRevision:0,confirm:'APPROVE_DRAFT_DELIVERY'}),env,async()=>items,ctx);
  assert.equal(r.status,200);assert.equal((await r.json()).processing,true);await Promise.all(tasks);
  assert.equal(mock.inputs.length,1);assert.equal(mock.inputs[0].saveToDraft,true);
  assert.equal((await first(db,'SELECT state FROM social_publications WHERE project_id=?',p.id)).state,'draft');
  assert.equal(await first(db,"SELECT * FROM social_publications WHERE project_id='124'"),null);
  await tick(env,async()=>items);assert.equal(mock.inputs.length,1);
 }finally{mock.restore();db.close();}
});
