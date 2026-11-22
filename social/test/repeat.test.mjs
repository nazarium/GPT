import test from 'node:test';
import assert from 'node:assert/strict';
import {database,raw,channel,imageResponse} from './helpers.mjs';
import {normalizeCatalog,fingerprint} from '../catalog.mjs';
import {syncCatalog,markReady,releaseProjects,run,first,all} from '../store.mjs';
import {defaults,validateSettings} from '../settings.mjs';
import {prepareRepeatDrafts} from '../repeat.mjs';
import {dispatchOne} from '../engine.mjs';
async function setup() {
 const db=database(),p=normalizeCatalog([raw()])[0],hash=await fingerprint(p),settings={...defaults(),allowRepeatDrafts:true,archiveEnabled:false};
 await syncCatalog(db,[p],1);await markReady(db,p.id,hash,{},1);
 await run(db,"INSERT INTO social_meta(key,value) VALUES('settings',?)",JSON.stringify(settings));
 await run(db,"UPDATE social_meta SET value='1' WHERE key='live'");
 const env={SOCIAL_DB:db,SOCIAL_MODE:'live',BUFFER_API_KEY:'test',BUFFER_CHANNELS:JSON.stringify([channel])};
 return {db,p,hash,settings,env};
}
test('repeats are optional and cannot enable scheduled publications',async()=>{
 const {db,p,hash,settings,env}=await setup();
 await assert.rejects(prepareRepeatDrafts(env,p,hash,{}, {...settings,allowRepeatDrafts:false}),/вимкнена/);
 await assert.rejects(prepareRepeatDrafts(env,p,hash,{}, {...settings,deliveryMode:'schedule'}),/вимкнена/);
 assert.equal(validateSettings(defaults()).allowRepeatDrafts,false);
 assert.equal(validateSettings(settings).allowRepeatDrafts,true);db.close();
});
test('explicit repeat creates one more draft, records the old ID and does not endlessly resend on Cron',async()=>{
 const {db,p,hash,settings,env}=await setup();let created=0;
 const fetcher=async(url,init)=>{
  if(String(url).startsWith('https://archi-create.com.ua'))return imageResponse();
  const input=JSON.parse(init.body).variables.input;assert.equal(input.saveToDraft,true);created++;
  return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'draft-'+created,status:'draft',schedulingType:'automatic'}}}});
 };
 await releaseProjects(db,null,2,[channel],settings);await dispatchOne(env,async()=>[raw()],2,fetcher);
 assert.equal((await first(db,'SELECT buffer_id FROM social_drafts')).buffer_id,'draft-1');
 await prepareRepeatDrafts(env,p,hash,{},settings,3);
 const history=JSON.parse((await first(db,"SELECT detail FROM social_events WHERE event='repeat_drafts_requested'")).detail);
 assert.equal(history.drafts[0].buffer_id,'draft-1');
 await releaseProjects(db,null,4,[channel],settings);await dispatchOne(env,async()=>[raw()],4,fetcher);
 assert.equal((await first(db,'SELECT buffer_id FROM social_drafts')).buffer_id,'draft-2');
 await dispatchOne(env,async()=>[raw()],5,fetcher);assert.equal(created,2);
 assert.equal((await all(db,'SELECT * FROM social_publications')).length,1);db.close();
});
test('an in-flight or unknown attempt is not erased by a repeat request',async()=>{
 for(const state of ['sending','uncertain']) {
  const {db,p,hash,settings,env}=await setup();
  await releaseProjects(db,null,2,[channel],settings);
  await run(db,'UPDATE social_publications SET state=?',state);
  await assert.rejects(prepareRepeatDrafts(env,p,hash,{},settings,3),/результат невідомий/);
  assert.equal((await first(db,'SELECT state FROM social_publications')).state,state);
  assert.equal(await first(db,'SELECT * FROM social_locks'),null);db.close();
 }
});
test('repeat respects the shared queue lock and never modifies unrelated projects',async()=>{
 const {db,p,hash,settings,env}=await setup();
 await run(db,"INSERT INTO social_locks(name,token,expires_at) VALUES('tick','other',99999)");
 await assert.rejects(prepareRepeatDrafts(env,p,hash,{},settings,3),/зараз обробляється/);
 assert.equal((await first(db,'SELECT token FROM social_locks')).token,'other');
 assert.equal(await first(db,"SELECT * FROM social_events WHERE event='repeat_drafts_requested'"),null);db.close();
});
