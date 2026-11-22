import { validateEditorOptions } from './editor-options.mjs';
import { validateCaptions } from './captions.mjs';
import { normalizeCatalog,channels,fingerprint,buildPost,selectImages } from './catalog.mjs';
import { all,first,run,query,event } from './store.mjs';
import { readSettings,saveSettings,runtimeEnv,applyCaption } from './settings.mjs';
import { bufferRequest,createPost,GET_POST,bufferCredential } from './buffer.mjs';
import { inspectGallery,siteImageFetcher } from './media.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const DRAFTS='query Drafts($input: PostsInput!, $after: String) { posts(first: 50, after: $after, input: $input) { edges { node { id status text dueAt channelId channelService schedulingType assets { source mimeType } } } pageInfo { hasNextPage endCursor } } }';
export async function management(request,env,getCatalog,readBody) {
  const db=env.SOCIAL_DB,url=new URL(request.url),action=url.pathname.split('/').at(-1),now=Date.now();
  try {
    const s=await readSettings(db,env), effective=runtimeEnv(env,s);
    if(request.method==='GET'&&action==='settings')return json(s);
    if(request.method==='GET'&&action==='dashboard') {
      const projects=await all(db,'SELECT * FROM social_projects ORDER BY queue_order LIMIT 500');
      return json({settings:s,environmentMode:env.SOCIAL_MODE||'dry-run',keyConfigured:!!(await bufferCredential(env)).key,
        live:(await first(db,"SELECT value FROM social_meta WHERE key='live'"))?.value==='1'&&env.SOCIAL_MODE==='live',
        channels:channels(effective),tiktokAutoVerified:env.TIKTOK_PHOTO_AUTO_VERIFIED==='true',
        projects:projects.map(p=>({...p,project:JSON.parse(p.payload),selection:JSON.parse(p.selection),captions:JSON.parse(p.captions||'{}'),options:JSON.parse(p.options||'{}')})),
        drafts:await all(db,'SELECT project_id,platform,channel_id,buffer_id,state,due_at,fingerprint,updated_at FROM social_drafts ORDER BY due_at LIMIT 1500'),
        publications:await all(db,'SELECT project_id,platform,channel_id,state,attempts,next_attempt,buffer_id,external_url,error,updated_at FROM social_publications ORDER BY updated_at DESC LIMIT 1500'),
        events:await all(db,'SELECT * FROM social_events ORDER BY id DESC LIMIT 100')});
    }
    if(request.method==='GET'&&action==='drafts') {
      const input={organizationId:env.BUFFER_ORGANIZATION_ID,filter:{status:['draft'],channelIds:channels(env).map(c=>c.id)}};
      const data=await bufferRequest(env,DRAFTS,{input,after:url.searchParams.get('after')||null});
      return json(data.posts);
    }
    if(request.method==='GET'&&action==='draft-detail') {
      const row=await first(db,'SELECT * FROM social_drafts WHERE buffer_id=?',url.searchParams.get('id'));
      if(!row)throw new Error('Чернетку не знайдено в обліку AutoPoster');
      const {post}=await bufferRequest(env,GET_POST,{input:{id:row.buffer_id}});
      const configured=channels(env).find(c=>c.platform===row.platform);
      if(!configured||post.channelId!==configured.id)throw new Error('Канал чернетки не збігається з налаштуванням');
      return json(post);
    }
    if(request.method!=='POST')return json({error:'Метод не дозволений'},405);
    const input=await readBody(request);
    if(action==='save') {
      if(input.settingsRevision!==s.revision)throw new Error('Налаштування змінилися; оновіть перегляд');
      const project=normalizeCatalog(await getCatalog()).find(p=>p.id===input.id);
      if(!project||input.fingerprint!==await fingerprint(project))throw new Error('Проєкт змінився; оновіть перегляд');
      const selection=input.selection||{},captions=validateCaptions(input.captions),options=validateEditorOptions(input.options);
      if(!options?.dueAt)throw new Error('Вкажіть дату публікації');
      if(typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(k=>!['instagram','facebook','tiktok'].includes(k)))throw new Error('Некоректний вибір фото');
      for(const platform of ['instagram','facebook','tiktok'])selectImages(project,selection,platform);
      const updated=await run(db,`UPDATE social_projects SET selection=?,captions=?,options=?,saved_at=?,ready_hash=NULL
        WHERE id=? AND active=1 AND fingerprint=? AND saved_at IS ?
        AND NOT EXISTS(SELECT 1 FROM social_publications WHERE project_id=? AND state IN ('sending','uncertain'))
        AND NOT EXISTS(SELECT 1 FROM social_drafts WHERE project_id=? AND state IN ('saving','uncertain'))`,
        JSON.stringify(selection),JSON.stringify(captions||{}),JSON.stringify(options),now,project.id,input.fingerprint,input.savedAt??null,project.id,project.id);
      if(!updated.meta.changes)throw Object.assign(new Error('Публікація змінилась або надсилається. Відкрийте проєкт повторно.'),{status:409});
      await event(db,project.id,null,'publication_saved','Saved without Buffer delivery; ready flag cleared',now);
      return json({saved:true,savedAt:now,bufferMutations:0});
    }
    if(action==='settings')return json({settings:await saveSettings(db,input,env,now),message:'Збережено. Відправлення призупинено; готовність проєктів потрібно перевірити повторно.'});
    if(action==='draft') {
      if(input.settingsRevision!==s.revision)throw new Error('Налаштування змінилися; оновіть перегляд');
      const project=normalizeCatalog(await getCatalog()).find(p=>p.id===input.id);
      if(!project||await fingerprint(project)!==input.fingerprint)throw new Error('Проєкт змінився; оновіть перегляд');
      const channel=channels(effective).find(c=>c.platform===input.platform);
      if(!channel)throw new Error('Платформу вимкнено');
      const existing=await first(db,'SELECT * FROM social_drafts WHERE project_id=? AND platform=?',project.id,channel.platform);
      if(existing) {
        if(existing.state==='draft'&&existing.buffer_id)return json({state:'draft',bufferId:existing.buffer_id,existing:true});
        throw new Error('Попередню спробу потрібно перевірити в Buffer. Автоматичного повтору немає.');
      }
      if(await first(db,'SELECT 1 AS found FROM social_publications WHERE project_id=? AND platform=?',project.id,channel.platform))throw new Error('Проєкт уже має запис публікації; перевірте його стан');
      const captions=validateCaptions(input.captions)||{};
      const editorOptions=validateEditorOptions(input.options)||{};
      const selection=input.selection||{};
      for(const platform of ['instagram','facebook','tiktok'])selectImages(project,selection,platform);
      let plan=applyCaption(buildPost(project,channel,selection),project,{...s,deliveryMode:'draft'},captions,editorOptions);
      if(plan.issues.length)throw new Error(plan.issues.join('; '));
      const media=await inspectGallery({...project,images:plan.images},siteImageFetcher(env));
      plan=applyCaption(buildPost(project,channel,selection,media),project,{...s,deliveryMode:'draft'},captions,editorOptions);
      if(plan.issues.length)throw new Error(plan.issues.join('; '));
      const due=new Date(input.dueAt);
      if(!input.dueAt||!Number.isFinite(+due))throw new Error('Вкажіть дату чернетки');
      const payload={...plan.input,dueAt:due.toISOString(),saveToDraft:true};
      const claimed=await run(db,"INSERT OR IGNORE INTO social_drafts(project_id,platform,channel_id,state,payload,due_at,fingerprint,updated_at) VALUES(?,?,?,'saving',?,?,?,?)",project.id,channel.platform,channel.id,JSON.stringify(payload),payload.dueAt,input.fingerprint,now);
      if(!claimed.meta.changes)throw new Error('Чернетка вже обробляється в іншій вкладці');
      let post;
      try {post=await createPost(env,payload);}
      catch(error) {
        await run(db,"UPDATE social_drafts SET state=?,updated_at=? WHERE project_id=? AND platform=?",error.kind==='blocked'?'blocked':'uncertain',now,project.id,channel.platform);
        throw new Error('Результат створення не підтверджено. Перевірте Buffer перед повторною спробою.');
      }
      if(post.status!=='draft')throw new Error('Buffer повернув неочікуваний стан. Перевірте допис у Buffer.');
      console.log(JSON.stringify({event:'buffer_draft_created',projectId:project.id,platform:channel.platform,bufferId:post.id}));
      await db.batch([
        query(db,"UPDATE social_projects SET captions=json_patch(captions,?),options=json_patch(options,?) WHERE id=? AND fingerprint=?",JSON.stringify(captions),JSON.stringify(editorOptions),project.id,input.fingerprint),
        query(db,"UPDATE social_drafts SET state='draft',buffer_id=?,updated_at=? WHERE project_id=? AND platform=?",post.id,now,project.id,channel.platform),
        query(db,"INSERT INTO social_events(project_id,platform,event,detail,created_at) VALUES(?,?,'buffer_draft_created',?,?)",project.id,channel.platform,JSON.stringify({bufferId:post.id,dueAt:payload.dueAt,fingerprint:input.fingerprint}),now),
      ]);
      return json({state:'draft',bufferId:post.id});
    }
    return json({error:'Дію не знайдено'},404);
  }catch(error){return json({error:error.message},error.status||400);}
}
