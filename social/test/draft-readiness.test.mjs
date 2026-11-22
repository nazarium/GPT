import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {database,raw,channel} from './helpers.mjs';
import {syncCatalog,markReady,releaseProjects,run,first,all} from '../store.mjs';
import {normalizeCatalog,fingerprint} from '../catalog.mjs';
import {storedState} from '../engine.mjs';
import {bufferRequest,GET_POST,GET_CHANNELS} from '../buffer.mjs';
import {reconcileProjectDrafts} from '../reconcile.mjs';

async function setup(state='draft') {
 const db=database(),p=normalizeCatalog([raw()])[0],hash=await fingerprint(p);
 await syncCatalog(db,[p],1);
 await run(db,"INSERT INTO social_publications(project_id,platform,channel_id,state,buffer_id,attempts,payload,updated_at) VALUES(?,?,?,?,?,1,?,1)",p.id,'instagram','ig',state,'existing',JSON.stringify({saveToDraft:true}));
 await run(db,"INSERT INTO social_drafts(project_id,platform,channel_id,buffer_id,state,fingerprint,updated_at) VALUES(?,?,?,?,'draft',?,1)",p.id,'instagram','ig','existing',hash);
 return {db,p,hash,env:{SOCIAL_DB:db,BUFFER_API_KEY:'test',BUFFER_CHANNELS:JSON.stringify([channel])}};
}
const existing=async()=>Response.json({data:{post:{id:'existing',channelId:'ig',status:'draft',schedulingType:'notification'}}});
const missing=async()=>Response.json({errors:[{message:'Post not found for id: existing'}]},{status:404});

test('a notification draft is a draft, not a manual publication task',()=>{
 assert.equal(storedState({status:'draft',schedulingType:'notification'}),'draft');
 assert.equal(storedState({status:'draft',schedulingType:'automatic'}),'draft');
 assert.equal(storedState({status:'sent',schedulingType:'notification'}),'manual_required');
});
test('existing draft can be unready and ready again without requeueing or changing its Buffer ID',async()=>{
 const {db,p,hash,env}=await setup();
 await reconcileProjectDrafts(env,p.id,2,existing);
 await markReady(db,p.id,hash,{},2);
 await run(db,'UPDATE social_projects SET ready_hash=NULL WHERE id=?',p.id);
 await markReady(db,p.id,hash,{},3);
 await releaseProjects(db,null,3,[channel],{archiveEnabled:false});
 const row=await first(db,'SELECT * FROM social_publications');
 assert.equal(row.state,'draft');assert.equal(row.buffer_id,'existing');assert.equal(row.attempts,1);
 assert.equal((await all(db,'SELECT * FROM social_publications')).length,1);db.close();
});
test('real in-flight, uncertain and published posts remain protected',async()=>{
 for(const state of ['sending','uncertain','scheduled','sent','manual_required','failed']) {
  const {db,p,hash}=await setup(state);
  await assert.rejects(markReady(db,p.id,hash,{},2),/Повторне створення заблоковане/);
  assert.equal((await first(db,'SELECT buffer_id FROM social_publications')).buffer_id,'existing');db.close();
 }
});
test('legacy blocked entries with a Buffer ID are not reset to pending',async()=>{
 const {db,p,hash}=await setup('blocked');await markReady(db,p.id,hash,{},2);
 assert.equal((await first(db,'SELECT state FROM social_publications')).state,'blocked');db.close();
});
test('only an explicit not-found result for the exact ID can release a missing draft; history is retained',async()=>{
 const {db,p,env}=await setup();
 assert.deepEqual(await reconcileProjectDrafts(env,p.id,2,missing),{checked:1,missing:1});
 const q=await first(db,'SELECT * FROM social_publications');
 assert.equal(q.buffer_id,null);assert.equal(q.state,'pending');assert.equal(q.attempts,0);
 assert.equal(await first(db,'SELECT * FROM social_drafts'),null);
 const history=await first(db,"SELECT detail FROM social_events WHERE event='draft_confirmed_absent'");
 assert.equal(JSON.parse(history.detail).bufferId,'existing');db.close();
});
test('timeouts, authentication errors, generic 404 and null post never release the saved Buffer ID',async()=>{
 for(const fetcher of [
  async()=>{throw Error('timeout');},
  async()=>new Response('',{status:403}),
  async()=>Response.json({errors:[{message:'Not found'}]},{status:404}),
  async()=>Response.json({errors:[{message:'Post not found for id: some-other-id'}]},{status:404}),
  async()=>Response.json({data:{post:null}})
 ]) {
  const {db,p,env}=await setup();await assert.rejects(reconcileProjectDrafts(env,p.id,2,fetcher));
  assert.equal((await first(db,'SELECT buffer_id FROM social_publications')).buffer_id,'existing');
  assert.equal((await first(db,'SELECT buffer_id FROM social_drafts')).buffer_id,'existing');db.close();
 }
});
test('an actual scheduled Buffer post is not allowed to be re-approved as a fresh draft',async()=>{
 const {db,p,hash,env}=await setup();
 await reconcileProjectDrafts(env,p.id,2,async()=>Response.json({data:{post:{id:'existing',channelId:'ig',status:'scheduled',schedulingType:'automatic'}}}));
 await assert.rejects(markReady(db,p.id,hash,{},2),/Повторне створення/);
 assert.equal((await first(db,'SELECT state FROM social_publications')).state,'scheduled');db.close();
});
test('not-found classification is restricted to post reads and never to create or channel reads',async()=>{
 await assert.rejects(bufferRequest({BUFFER_API_KEY:'test'},GET_CHANNELS,{input:{id:'existing'}},missing),e=>e.kind!=='missing');
 await assert.rejects(bufferRequest({BUFFER_API_KEY:'test'},GET_POST,{input:{id:'existing'}},missing),e=>e.kind==='missing');
});
test('draft-state migration preserves IDs, payloads and protected rows while fixing both legacy draft states',()=>{
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_social.sql','0002_social_drafts.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 db.exec("INSERT INTO social_projects(id,payload,fingerprint,kind,queue_order,first_seen,updated_at) VALUES('123','{}','hash','archive',1,1,1)");
 const add=db.prepare("INSERT INTO social_publications(project_id,platform,channel_id,state,buffer_id,payload,updated_at) VALUES('123',?,?,?,?,'{\"saveToDraft\":true}',1)");
 for(const [platform,state] of [['instagram','blocked'],['tiktok','manual_required'],['facebook','sent']]) {
  add.run(platform,platform,state,platform+'-id');
  db.prepare("INSERT INTO social_drafts(project_id,platform,buffer_id,state,fingerprint,updated_at) VALUES('123',?,?,'draft','hash',1)").run(platform,platform+'-id');
 }
 db.exec(readFileSync(new URL('../migrations/0003_publication_draft_state.sql',import.meta.url),'utf8'));
 const rows=db.prepare('SELECT platform,state,buffer_id,payload FROM social_publications ORDER BY platform').all();
 assert.deepEqual(rows.map(r=>r.state),['sent','draft','draft']);
 assert.equal(rows[2].buffer_id,'tiktok-id');assert.equal(JSON.parse(rows[2].payload).saveToDraft,true);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_drafts').get().n,3);
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='social_due'").get());db.close();
});
