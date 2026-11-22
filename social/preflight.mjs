import {normalizeCatalog,channels,fingerprint,buildPost,selectImages} from './catalog.mjs';
import {validateCaptions} from './captions.mjs';
import {validateEditorOptions} from './editor-options.mjs';
import {applyCaption} from './settings.mjs';
import {inspectGallery,siteImageFetcher} from './media.mjs';
import {all,first} from './store.mjs';
function explain(message) {
 if(message.startsWith('Gallery has')||message.startsWith('Фото більше за встановлений ліміт'))return 'Фото більше за ліміт платформи. Виберіть меншу галерею.';
 if(message.includes('8MB'))return 'Фото перевищує ліміт 8 МБ.';
 if(message==='Invalid selected photo indexes')return 'Виберіть щонайменше одне фото; перевірте індекси й повтори.';
 return message;
}
export async function preflightProject(input,env,settings,getCatalog,fetcher=fetch) {
 const issues=[],plans=[],mapping=channels(env),add=(platform,reason)=>{const text=explain(reason);if(!issues.some(i=>i.platform===platform&&i.reason===text))issues.push({platform,reason:text});};
 const project=normalizeCatalog(await getCatalog()).find(p=>p.id===input.id);
 const stored=await first(env.SOCIAL_DB,'SELECT * FROM social_projects WHERE id=?',input.id);
 const hash=project?await fingerprint(project):null;
 if(!project||!stored?.active)add(null,'Проєкт прихований або відсутній у каталозі.');
 else if(input.fingerprint!==hash||stored.fingerprint!==hash)add(null,'Проєкт змінився. Оновіть каталог і відкрийте його повторно.');
 if(input.settingsRevision!==settings.revision)add(null,'Налаштування змінилися. Оновіть перегляд.');
 if(settings.deliveryMode!=='draft')add(null,'Масова передача доступна лише в чернетки Buffer.');
 if(!mapping.length)add(null,'Немає ввімкнених платформ для передачі.');
 const selection=input.selection||{};let captions={},options={};
 try{captions=validateCaptions(input.captions)||{};}catch(error){add(['instagram','facebook','tiktok'].find(p=>error.message.toLowerCase().includes(p))||null,error.message);}
 try{options=validateEditorOptions(input.options)||{};}catch(error){add(error.message.includes('Instagram')?'instagram':null,error.message);}
 if(typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(k=>!['instagram','facebook','tiktok'].includes(k)))add(null,'Некоректний вибір фотографій.');
 if(project&&hash===input.fingerprint&&!issues.length) {
  const publications=await all(env.SOCIAL_DB,'SELECT platform,state FROM social_publications WHERE project_id=?',project.id);
  const drafts=await all(env.SOCIAL_DB,'SELECT platform,state FROM social_drafts WHERE project_id=?',project.id);
  const mediaCache=new Map(),imageFetcher=siteImageFetcher(env,fetcher);
  for(const channel of mapping) {
   const platform=channel.platform,existing=publications.find(p=>p.platform===platform),draft=drafts.find(d=>d.platform===platform);
   if(['sending','uncertain'].includes(existing?.state)||['saving','uncertain'].includes(draft?.state))add(platform,'Попередня передача виконується або її результат невідомий. Спочатку звірте Buffer.');
   else if(!settings.allowRepeatDrafts&&(draft||['scheduled','manual_required','sent','failed'].includes(existing?.state)))add(platform,'Чернетка або допис уже є в обліку. Повторна передача вимкнена.');
   try {
    selectImages(project,selection,platform);
    let plan=applyCaption(buildPost(project,channel,selection),project,settings,captions,options);
    if(!plan.issues.length) {
     const media=[];
     for(const url of plan.images) {
      if(!mediaCache.has(url))mediaCache.set(url,inspectGallery({...project,images:[url]},imageFetcher));
      media.push(...await mediaCache.get(url));
     }
     plan=applyCaption(buildPost(project,channel,selection,media),project,settings,captions,options);
    }
    plan.issues.forEach(reason=>add(platform,reason));plans.push({platform,warnings:plan.warnings,photoCount:plan.images.length});
   }catch(error){add(platform,explain(error.message));}
  }
 }
 return {projectId:input.id,fingerprint:hash,settingsRevision:settings.revision,checkedAt:Date.now(),ready:issues.length===0,issues,plans};
}
