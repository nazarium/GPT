import { preflightProject } from './preflight.mjs';
import { credentialAdmin } from './credentials.mjs';
import { validateEditorOptions } from './editor-options.mjs';
import { validateCaptions } from './captions.mjs';
import { prepareRepeatDrafts } from './repeat.mjs';
import { reconcileProjectDrafts } from './reconcile.mjs';
import { readSettings,runtimeEnv,applyCaption } from './settings.mjs';
import { management } from './management.mjs';
import { normalizeCatalog, channels, archiveSlot, fingerprint, buildPost, selectImages } from './catalog.mjs';
import { inspectGallery,siteImageFetcher } from './media.mjs';
import { bufferRequest, createPost, GET_POST, GET_CHANNELS, GET_ORGANIZATIONS } from './buffer.mjs';
import { all, first, run, query, syncCatalog, releaseProjects, claim, event, markReady } from './store.mjs';

const live = async env => env.SOCIAL_MODE === 'live' && (await first(env.SOCIAL_DB,"SELECT value FROM social_meta WHERE key='live'"))?.value === '1';
const response = (body, status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

export async function readChannels(env,fetcher=fetch) {
  if(!env.BUFFER_ORGANIZATION_ID)throw new Error('BUFFER_ORGANIZATION_ID is not configured');
  const data=await bufferRequest(env,GET_CHANNELS,{input:{organizationId:env.BUFFER_ORGANIZATION_ID}},fetcher);
  if(!Array.isArray(data.channels))throw new Error('Buffer did not return a channel list');
  return data.channels;
}
export async function verifyChannels(env, fetcher=fetch, requireMapping=true) {
  if (!env.BUFFER_ORGANIZATION_ID) throw new Error('BUFFER_ORGANIZATION_ID is not configured');
  const mapping=channels(env);
  if (requireMapping && !mapping.length) throw new Error('No Buffer channels configured');
  const remoteChannels=await readChannels(env,fetcher);
  for (const c of mapping) {
    const remote=remoteChannels.find(r=>r.id===c.id);
    if (!remote || remote.service!==c.platform || remote.isDisconnected || remote.isLocked || remote.isQueuePaused) throw new Error('Channel is unavailable or mapping is incorrect');
    if (requireMapping && c.mode==='notification' && !remote.hasActiveMemberDevice) throw new Error('Register Buffer mobile notifications or use the local manual packet');
    if (c.platform==='facebook' && remote.type!=='page') throw new Error('Facebook automatic integration requires a Page');
  }
  return remoteChannels;
}

export function storedState(post) {
  if (post.status==='draft') return 'draft';
  if (post.schedulingType==='notification') return 'manual_required';
  if (post.status==='sent') return 'sent';
  if (post.status==='error') return 'failed';
  if (['scheduled','sending'].includes(post.status)) return 'scheduled';
  return 'blocked';
}

async function poll(env, now, fetcher) {
  const rows=await all(env.SOCIAL_DB,`SELECT * FROM social_publications WHERE state='scheduled' AND updated_at<=? ORDER BY updated_at LIMIT 3`,now-55*60_000);
  for (const row of rows) {
    const {post}=await bufferRequest(env,GET_POST,{input:{id:row.buffer_id}},fetcher,now);
    if (!post || post.id!==row.buffer_id || post.channelId!==row.channel_id) throw new Error('Post/channel mismatch during status check');
    await env.SOCIAL_DB.batch([
      query(env.SOCIAL_DB,'UPDATE social_publications SET state=?,external_url=?,updated_at=? WHERE project_id=? AND platform=? AND buffer_id=?',storedState(post),post.externalLink||null,now,row.project_id,row.platform,row.buffer_id),
      query(env.SOCIAL_DB,'INSERT INTO social_events(project_id,platform,event,detail,created_at) VALUES(?,?,?,?,?)',row.project_id,row.platform,'status',post.status,now),
    ]);
  }
}

export async function dispatchOne(env, getCatalog, now, fetcher=fetch) {
  if (!await live(env)) return {mode:'dry-run'};
  const db=env.SOCIAL_DB;
  const settings=await readSettings(db,env);
  env=runtimeEnv(env,settings);
  const platforms=channels(env).map(c=>c.platform);
  const row=await first(db,`SELECT q.*,p.payload AS project,p.fingerprint,p.selection,p.captions,p.options FROM social_publications q JOIN social_projects p ON p.id=q.project_id
    WHERE q.state IN ('pending','retry') AND q.next_attempt<=? AND q.attempts<? AND q.buffer_id IS NULL AND q.platform IN (SELECT value FROM json_each(?)) AND p.active=1 AND p.ready_hash=p.fingerprint
    ORDER BY p.kind='archive',p.released_at,p.queue_order,q.project_id,q.platform LIMIT 1`,now,settings.retryLimit,JSON.stringify(platforms));
  if (!row) return {mode:'idle'};
  const channel=channels(env).find(c=>c.platform===row.platform && c.id===row.channel_id);
  if (!channel) return {mode:'blocked',reason:'Stored channel differs from configuration; reconcile mapping'};
  const project=JSON.parse(row.project), selection=JSON.parse(row.selection);
  let plan=applyCaption(buildPost(project,channel,selection),project,settings,JSON.parse(row.captions||'{}'),JSON.parse(row.options||'{}'));
  if (!plan.issues.length) {
    try {
      const media=await inspectGallery({...project,images:plan.images},siteImageFetcher(env,fetcher));
      plan=applyCaption(buildPost(project,channel,selection,media),project,settings,JSON.parse(row.captions||'{}'),JSON.parse(row.options||'{}'));
    } catch(error) { plan.issues.push('Не вдалося перевірити оригінальні фото: '+error.message); }
  }
  if (plan.issues.length) {
    await run(db,"UPDATE social_publications SET state='blocked',error=?,updated_at=? WHERE project_id=? AND platform=? AND state IN ('pending','retry')",plan.issues.join('; '),now,row.project_id,row.platform);
    return {mode:'blocked',projectId:row.project_id,platform:row.platform,issues:plan.issues};
  }
  // Re-read the real catalog after potentially slow media checks. Hidden/deleted/edited
  // projects must not be submitted using a stale snapshot.
  const current=normalizeCatalog(await getCatalog()).find(p=>p.id===project.id);
  if (!current || await fingerprint(current)!==row.fingerprint) return {mode:'changed'};
  if (!await live(env)) return {mode:'dry-run'};
  const token=crypto.randomUUID();
  const input={...plan.input,dueAt:JSON.parse(row.options||'{}').dueAt||new Date(now+settings.dispatchDelayMinutes*60_000).toISOString()};
  if (!await claim(db,row.project_id,row.platform,token,input,now,settings.retryLimit)) return {mode:'claimed-elsewhere'};
  let post;
  try { post=await createPost(env,input,fetcher,now); }
  catch (error) {
    const state=error.kind || 'uncertain';
    const exhausted=state==='retry' && row.attempts+1>=settings.retryLimit;
    await db.batch([
      query(db,'UPDATE social_publications SET state=?,error=?,next_attempt=?,updated_at=? WHERE project_id=? AND platform=? AND attempt_token=? AND state=\'sending\'',exhausted?'blocked':state,error.kind?error.message:'Outcome unknown; reconcile',error.retryAt||now+2**(row.attempts+1)*60_000,now,row.project_id,row.platform,token),
      query(db,'INSERT INTO social_events(project_id,platform,event,detail,created_at) VALUES(?,?,?,?,?)',row.project_id,row.platform,'attempt',state,now),
    ]);
    return {mode:state};
  }
  // If this transaction fails the durable sending record remains, becomes uncertain,
  // and requires reconciliation. No second createPost is attempted.
  console.log(JSON.stringify({event:'buffer_created',projectId:row.project_id,platform:row.platform,bufferId:post.id}));
  const statements=[
    query(db,"UPDATE social_publications SET buffer_id=?,state=?,external_url=?,error=NULL,updated_at=? WHERE project_id=? AND platform=? AND attempt_token=? AND state='sending'",post.id,storedState(post),post.externalLink||null,now,row.project_id,row.platform,token),
    query(db,'INSERT INTO social_events(project_id,platform,event,detail,created_at) VALUES(?,?,?,?,?)',row.project_id,row.platform,'created',post.id,now),
  ];
  if(post.status==='draft') statements.push(query(db,"INSERT OR IGNORE INTO social_drafts(project_id,platform,channel_id,buffer_id,state,payload,due_at,fingerprint,updated_at) VALUES(?,?,?,?,'draft',?,?,?,?)",project.id,channel.platform,channel.id,post.id,JSON.stringify(input),input.dueAt,row.fingerprint,now));
  await db.batch(statements);
  return {mode:storedState(post),bufferId:post.id};
}

export async function tick(env, getCatalog, now=Date.now(), fetcher=fetch, scheduledTime=now) {
  if (!env.SOCIAL_DB) return {mode:'not-configured'};
  const db=env.SOCIAL_DB, token=crypto.randomUUID();
  const lock=await run(db,`INSERT INTO social_locks(name,token,expires_at) VALUES('tick',?,?)
    ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE social_locks.expires_at<?`,token,now+10*60_000,now);
  if (!lock.meta.changes) return {mode:'locked'};
  try {
    const catalog=normalizeCatalog(await getCatalog());
    await syncCatalog(db,catalog,now);
    await run(db,"UPDATE social_publications SET state='uncertain',error='Interrupted attempt; inspect Buffer before retry',updated_at=? WHERE state='sending' AND updated_at<?",now,now-10*60_000);
    const settings=await readSettings(db,env);
    env=runtimeEnv(env,settings);
    const mapping=channels(env);
    const slot=settings.archiveEnabled?archiveSlot(scheduledTime,settings.archiveHour,settings.archiveDays,settings.timezone,settings.archiveMinute):null;
    await releaseProjects(db,slot,now,mapping,settings);
    if (!await live(env)) return {mode:'dry-run',projects:catalog.length};
    const approved=(await first(db,"SELECT value FROM social_meta WHERE key='channels'"))?.value;
    if (approved!==await fingerprint(mapping)) throw new Error('Channel configuration changed; activate again after review');
    await verifyChannels(env,fetcher);
    await poll(env,now,fetcher);
    return await dispatchOne(env,getCatalog,now,fetcher);
  } finally { await run(db,"DELETE FROM social_locks WHERE name='tick' AND token=?",token); }
}

async function body(request) {
  const reader=request.body?.getReader();
  if (!reader) throw new Error('JSON body required');
  const chunks=[];let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.length;if(size>65536)throw new Error('Request too large');chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes=new Uint8Array(size);let offset=0;
  for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Start a bounded background pass without waiting for the next Cron slot.
// D1 locks/claims and the normal live/settings checks remain authoritative.
export async function kickImmediate(env,getCatalog,ctx,force=false) {
  if (!ctx?.waitUntil || !await live(env) || (!force&&(await readSettings(env.SOCIAL_DB,env)).archiveEnabled)) return false;
  ctx.waitUntil((async()=>{
    const started=Date.now();
    for(let i=0;i<3 && Date.now()-started<8000;i++) {
      if(!force&&(await readSettings(env.SOCIAL_DB,env)).archiveEnabled)break;
      const result=await tick(env,getCatalog);
      if(['idle','locked','dry-run','not-configured'].includes(result.mode))break;
    }
  })().catch(async error=>{
    console.error(JSON.stringify({event:'immediate_queue_error',message:error.message}));
    await event(env.SOCIAL_DB,null,null,'immediate_queue_error','Immediate pass stopped; Cron will check durable queue',Date.now());
  }));
  return true;
}

// Called ONLY after the site's existing admin authentication and Origin checks.
export async function socialAdmin(request,env,getCatalog,ctx) {
  if (!env.SOCIAL_DB) return response({error:'SOCIAL_DB is not configured'},503);
  const db=env.SOCIAL_DB, url=new URL(request.url), action=url.pathname.split('/').at(-1), now=Date.now();
  try {
    if (action === 'credential') return await credentialAdmin(request, env, body);
    if (['dashboard','settings','drafts','draft','draft-detail','save'].includes(action)) return management(request,env,getCatalog,body);
    const settings=await readSettings(db,env);
    env=runtimeEnv(env,settings);
    if (request.method==='GET' && action==='status') return response({mode:await live(env)?'live':'dry-run',
      projects:await all(db,'SELECT id,fingerprint,ready_hash,kind,active,released_at FROM social_projects ORDER BY queue_order LIMIT 500'),
      publications:await all(db,'SELECT * FROM social_publications ORDER BY updated_at DESC LIMIT 1500'),
      events:await all(db,'SELECT * FROM social_events ORDER BY id DESC LIMIT 100')});
    if (request.method==='GET' && action==='preview') {
      const p=normalizeCatalog(await getCatalog()).find(p=>p.id===url.searchParams.get('id'));
      if (!p) return response({error:'Visible project not found'},404);
      const stored=await first(db,'SELECT selection,captions,options FROM social_projects WHERE id=?',p.id);
      return response({project:p,fingerprint:await fingerprint(p),settingsRevision:settings.revision,selection:JSON.parse(stored?.selection||'{}'),captions:JSON.parse(stored?.captions||'{}'),options:JSON.parse(stored?.options||'{}'),plans:channels(env).map(c=>applyCaption(buildPost(p,c,JSON.parse(stored?.selection||'{}')),p,settings,JSON.parse(stored?.captions||'{}'),JSON.parse(stored?.options||'{}')))});
    }
    if (request.method==='GET' && action==='channels') return response(await readChannels(env));
    if (request.method==='GET' && action==='organizations') return response((await bufferRequest(env,GET_ORGANIZATIONS,{})).account.organizations);
    if (request.method!=='POST') return response({error:'Method not allowed'},405);
    const input=await body(request);
    if(action==='preflight')return response(await preflightProject(input,env,settings,getCatalog));
    if (action==='pause') {
      await run(db,"UPDATE social_meta SET value='0' WHERE key='live'");
      await event(db,null,null,'paused','Already scheduled Buffer posts must be paused/cancelled in Buffer separately',now);
      return response({mode:'dry-run',warning:'Already scheduled posts remain in Buffer. Pause its queues or remove those posts there.'});
    }
    if (action==='sync') {
      const catalog=normalizeCatalog(await getCatalog());
      await syncCatalog(db,catalog,now); return response({projects:catalog.length,bufferMutations:0});
    }
    const captions=['submit','ready','repeat'].includes(action)?validateCaptions(input.captions):undefined;
    const editorOptions=['submit','ready','repeat'].includes(action)?validateEditorOptions(input.options):undefined;
    if(action==='submit'&&settings.deliveryMode!=='draft')throw new Error('Для передачі в чернетки виберіть режим «Лише чернетки Buffer»');
    const repeatSubmission=action==='submit'&&settings.allowRepeatDrafts&&!!await first(db,'SELECT 1 AS found FROM social_drafts WHERE project_id=?',input.id);
    if (action==='repeat'||repeatSubmission) {
      if(input.settingsRevision!==settings.revision)throw new Error('Налаштування змінилися; оновіть перегляд');
      if(!settings.allowRepeatDrafts||settings.deliveryMode!=='draft')throw new Error('Повторна передача чернеток вимкнена');
      const p=normalizeCatalog(await getCatalog()).find(p=>p.id===input.id);
      if(!p||input.fingerprint!==await fingerprint(p))throw new Error('Проєкт змінився; оновіть перегляд');
      const selection=input.selection||{};
      for(const platform of ['instagram','facebook','tiktok'])selectImages(p,selection,platform);
      await syncCatalog(db,normalizeCatalog(await getCatalog()),now);
      await verifyChannels(env);
      const result=await prepareRepeatDrafts(env,p,input.fingerprint,selection,settings,now,captions,editorOptions);
      const processing=await kickImmediate(env,getCatalog,ctx,true);
      return response({...result,ready:true,processing});
    }
    if (action==='ready'||action==='submit') {
      if((input.settingsRevision??0)!==settings.revision)throw new Error('Налаштування змінилися; оновіть перегляд');
      const p=normalizeCatalog(await getCatalog()).find(p=>p.id===input.id);
      if (!p || input.fingerprint!==await fingerprint(p)) throw new Error('Project changed; refresh preview');
      await syncCatalog(db,normalizeCatalog(await getCatalog()),now);
      const selection=input.selection||{};
      if (typeof selection!=='object' || Array.isArray(selection) || Object.keys(selection).some(k=>!['instagram','facebook','tiktok'].includes(k))) throw new Error('Invalid selection');
      for (const platform of ['instagram','facebook','tiktok']) selectImages(p,selection,platform);
      if(await first(db,"SELECT 1 AS found FROM social_drafts WHERE project_id=? AND state='draft' AND buffer_id IS NOT NULL",p.id))await verifyChannels(env);
      const reconciliation=await reconcileProjectDrafts(env,p.id,now);
      await markReady(db,p.id,input.fingerprint,selection,now,captions,editorOptions);
      const processing=await kickImmediate(env,getCatalog,ctx);
      return response({ready:true,processing,reconciliation});
    }
    if (action==='unready') {
      await run(db,'UPDATE social_projects SET ready_hash=NULL WHERE id=?',input.id);
      return response({ready:false,warning:'This does not cancel posts already sent to Buffer'});
    }
    if (action==='resume') {
      if (input.settingsRevision!==settings.revision) throw new Error('Налаштування змінилися; оновіть сторінку');
      if (env.SOCIAL_MODE!=='live') throw new Error('Відновлення заблоковане захищеним режимом Cloudflare');
      if (settings.deliveryMode!=='draft' || input.confirm!=='APPROVE_DRAFT_DELIVERY') throw new Error('Для планування дописів потрібна окрема явна активація');
      const approved=(await first(db,"SELECT value FROM social_meta WHERE key='channels'"))?.value;
      if (!approved) throw new Error('Спочатку виконайте першу активацію на вкладці налаштувань');
      await verifyChannels(env);
      await db.batch([
        query(db,"UPDATE social_meta SET value=? WHERE key='channels'",await fingerprint(channels(env))),
        query(db,"UPDATE social_meta SET value='1' WHERE key='live' AND json_extract((SELECT value FROM social_meta WHERE key='settings'),'$.deliveryMode')='draft' AND json_extract((SELECT value FROM social_meta WHERE key='settings'),'$.revision')=?",settings.revision),
        query(db,'INSERT INTO social_events(event,detail,created_at) VALUES(?,?,?)','resumed','User resumed draft delivery only',now),
      ]);
      const processing=await kickImmediate(env,getCatalog,ctx);
      return response({mode:await live(env)?'live':'dry-run',processing});
    }
    if (action==='activate') {
      if (env.SOCIAL_MODE!=='live' || input.confirm!=='APPROVE_FIRST_PUBLICATION') throw new Error('Explicit publishing approval and SOCIAL_MODE=live are required');
      await verifyChannels(env);
      await db.batch([
        query(db,"INSERT INTO social_meta(key,value) VALUES('channels',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",await fingerprint(channels(env))),
        query(db,"UPDATE social_meta SET value='1' WHERE key='live'"),
        query(db,'INSERT INTO social_events(event,detail,created_at) VALUES(?,?,?)','activated','Explicit approval through authenticated admin',now),
      ]);
      const processing=await kickImmediate(env,getCatalog,ctx);
      return response({mode:'live',processing});
    }
    if (action==='adopt') {
      const row=await first(db,'SELECT * FROM social_publications WHERE project_id=? AND platform=?',input.id,input.platform);
      if (!row || !['uncertain','blocked'].includes(row.state) || !row.payload) throw new Error('No uncertain attempt to reconcile');
      const {post}=await bufferRequest(env,GET_POST,{input:{id:input.bufferId}});
      const saved=JSON.parse(row.payload);
      if (post.channelId!==row.channel_id || post.text!==saved.text || JSON.stringify(post.assets.map(a=>a.source))!==JSON.stringify(saved.assets.map(a=>a.image.url))) throw new Error('Existing Buffer post does not match the attempted gallery');
      await run(db,'UPDATE social_publications SET buffer_id=?,state=?,external_url=?,error=NULL,updated_at=? WHERE project_id=? AND platform=? AND state=?',post.id,storedState(post),post.externalLink||null,now,input.id,input.platform,row.state);
      await event(db,input.id,input.platform,'adopted',post.id,now); return response({state:storedState(post)});
    }
    if (action==='refresh') {
      const row=await first(db,'SELECT * FROM social_publications WHERE project_id=? AND platform=?',input.id,input.platform);
      if (!row?.buffer_id || row.state==='sent') throw new Error('No Buffer post requiring a status refresh');
      const {post}=await bufferRequest(env,GET_POST,{input:{id:row.buffer_id}});
      if(post.channelId!==row.channel_id)throw new Error('Post/channel mismatch');
      await run(db,'UPDATE social_publications SET state=?,external_url=?,updated_at=? WHERE project_id=? AND platform=?',storedState(post),post.externalLink||null,now,input.id,input.platform);
      await event(db,input.id,input.platform,'refreshed',post.status,now);return response({state:storedState(post)});
    }
    if (action==='retry-confirmed-absent') {
      if (input.confirm!=='CHECKED_BUFFER_NO_POST_EXISTS') throw new Error('Inspect Buffer queue, drafts, sent and failed history first');
      const result=await run(db,"UPDATE social_publications SET state='pending',attempts=0,next_attempt=0,error=NULL,updated_at=? WHERE project_id=? AND platform=? AND state IN ('uncertain','blocked') AND buffer_id IS NULL",now,input.id,input.platform);
      if (!result.meta.changes) throw new Error('Cannot retry a known or completed Buffer post');
      await event(db,input.id,input.platform,'absence-confirmed','Human checked Buffer before retry',now); return response({state:'pending'});
    }
    if (action==='complete-manual') {
      const link=new URL(input.externalUrl);
      const domains={instagram:'instagram.com',facebook:'facebook.com',tiktok:'tiktok.com'};
      const domain=domains[input.platform];
      if (!domain || link.protocol!=='https:' || !(link.hostname===domain || link.hostname.endsWith('.'+domain)) || link.pathname==='/') throw new Error('Provide the published post URL');
      const result=await run(db,"UPDATE social_publications SET state='sent',external_url=?,updated_at=? WHERE project_id=? AND platform=? AND state IN ('manual_required','blocked')",link.href,now,input.id,input.platform);
      if (!result.meta.changes) throw new Error('No manual task to complete');
      await event(db,input.id,input.platform,'manual-completed',link.href,now); return response({state:'sent'});
    }
    return response({error:'Unknown social action'},404);
  } catch (error) { return response({error:error.message},error.status||400); }
}
