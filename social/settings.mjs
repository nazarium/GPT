import { descriptionFromCaption,tagsForPlatform,formatTags } from './editor-options.mjs';
import { channels, LIMITS, PLATFORMS } from './catalog.mjs';
import { first, query } from './store.mjs';
export function defaults(env={}) {
  return { revision:0, timezone:'Europe/Kyiv', archiveEnabled:true, archiveDays:[2,5],
    archiveHour:Number(env.SOCIAL_ARCHIVE_HOUR||10), archiveMinute:0, archiveOrder:'oldest',
    newProjectsEnabled:true, newProjectDelayHours:0, deliveryMode:'draft',
    dispatchDelayMinutes:15, retryLimit:5, allowRepeatDrafts:false,
    defaultTags:'',
    captionTemplate:'{title}{numberSuffix}\n\n{description}\n\n{url}',
    platforms:Object.fromEntries(PLATFORMS.map(p=>[p,{enabled:true,mode:p==='tiktok'?'notification':'automatic',maxPhotos:LIMITS[p]}])) };
}
export function validateSettings(input,env={}) {
  const d=defaults(env), s={};
  if(input.allowRepeatDrafts!==undefined&&typeof input.allowRepeatDrafts!=='boolean')throw new Error('Некоректний перемикач повторної передачі');
  s.allowRepeatDrafts=input.allowRepeatDrafts??false;
  formatTags(input.defaultTags??'');s.defaultTags=input.defaultTags??'';
  const integer=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)throw new Error('Некоректне поле: '+label);return v;};
  for(const key of ['archiveEnabled','newProjectsEnabled']) {
    if(typeof input[key]!=='boolean')throw new Error('Некоректний перемикач: '+key);s[key]=input[key];
  }
  if(typeof input.timezone!=='string'||input.timezone.length>80)throw new Error('Вкажіть часову зону');
  try {new Intl.DateTimeFormat('uk',{timeZone:input.timezone}).format();}catch{throw new Error('Невідома часова зона');}
  s.timezone=input.timezone;
  if(!Array.isArray(input.archiveDays)||!input.archiveDays.length||input.archiveDays.length>7||new Set(input.archiveDays).size!==input.archiveDays.length)throw new Error('Виберіть дні архіву');
  s.archiveDays=input.archiveDays.map(v=>integer(v,0,6,'день'));
  s.archiveHour=integer(input.archiveHour,0,23,'година');
  if(![0,15,30,45].includes(input.archiveMinute))throw new Error('Час обробки має бути кратним 15 хвилинам');
  s.archiveMinute=input.archiveMinute;
  if(!['oldest','newest'].includes(input.archiveOrder))throw new Error('Виберіть черговість архіву');
  s.archiveOrder=input.archiveOrder;
  s.newProjectDelayHours=integer(input.newProjectDelayHours,0,720,'затримка нових проєктів');
  s.dispatchDelayMinutes=integer(input.dispatchDelayMinutes,5,1440,'відступ перед публікацією');
  s.retryLimit=integer(input.retryLimit,1,5,'кількість спроб');
  if(!['draft','schedule'].includes(input.deliveryMode))throw new Error('Виберіть режим доставки');
  s.deliveryMode=input.deliveryMode;
  if(typeof input.captionTemplate!=='string'||!input.captionTemplate.trim()||input.captionTemplate.length>2000)throw new Error('Шаблон: від 1 до 2000 символів');
  const unknown=[...input.captionTemplate.matchAll(/\{([^{}]+)\}/g)].filter(m=>!['title','number','numberSuffix','description','url'].includes(m[1]));
  if(unknown.length)throw new Error('Невідоме поле шаблону: '+unknown[0][1]);
  if(!input.captionTemplate.includes('{title}'))throw new Error('Залиште {title} у шаблоні');
  s.captionTemplate=input.captionTemplate;
  s.platforms={};
  for(const p of PLATFORMS) {
    const v=input.platforms?.[p];if(!v||typeof v.enabled!=='boolean'||!['automatic','notification'].includes(v.mode))throw new Error('Перевірте налаштування '+p);
    if(p==='tiktok'&&v.mode==='automatic'&&env.TIKTOK_PHOTO_AUTO_VERIFIED!=='true')throw new Error('Автоматична галерея TikTok ще не підтверджена тестом; виберіть сповіщення');
    s.platforms[p]={enabled:v.enabled,mode:v.mode,maxPhotos:integer(v.maxPhotos,1,LIMITS[p],'ліміт фото '+p)};
  }
  if(!PLATFORMS.some(p=>s.platforms[p].enabled))throw new Error('Залиште хоча б одну платформу');
  return {...d,...s,revision:integer(input.revision,0,1e9,'версія')};
}
export async function readSettings(db,env={}) {
  const record=await first(db,"SELECT value FROM social_meta WHERE key='settings'");
  return record?validateSettings(JSON.parse(record.value),env):defaults(env);
}
export async function saveSettings(db,input,env={},now=Date.now()) {
  const value=validateSettings(input,env);
  const current=await readSettings(db,env);
  if(value.revision!==current.revision)throw Object.assign(new Error('Налаштування змінені в іншій вкладці. Оновіть сторінку.'),{status:409});
  const next={...value,revision:value.revision+1};
  const result=await db.batch([
    query(db,"INSERT INTO social_meta(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(social_meta.value,'$.revision')=?",JSON.stringify(next),value.revision),
    query(db,"UPDATE social_meta SET value='0' WHERE key='live'"),
    query(db,"UPDATE social_projects SET ready_hash=NULL WHERE ready_hash IS NOT NULL"),
    query(db,"INSERT INTO social_events(event,detail,created_at) VALUES('settings_changed',?,?)",JSON.stringify({revision:next.revision,livePaused:true}),now),
  ]);
  if(!result[0].meta.changes)throw Object.assign(new Error('Конфлікт збереження. Оновіть налаштування.'),{status:409});
  return next;
}
export function runtimeEnv(env,s) {
  const mapping=channels(env).filter(c=>s.platforms[c.platform].enabled).map(c=>({...c,mode:s.platforms[c.platform].mode}));
  return {...env,BUFFER_CHANNELS:JSON.stringify(mapping)};
}
export function applyCaption(plan,project,s,captions={},editor={}) {
  const fields={title:project.title,number:project.number,numberSuffix:project.number?' — '+project.number:'',description:project.description,url:project.url};
  let text=Object.hasOwn(captions,plan.platform)?captions[plan.platform]:s.captionTemplate.replace(/\{(title|number|numberSuffix|description|url)\}/g,(_,key)=>fields[key]??'').replace(/\n{3,}/g,'\n\n').trim();
  if(editor.useCommonCaption)text=editor.commonCaption||'';
  else if(editor.composeTitle&&!Object.hasOwn(captions,plan.platform))text=descriptionFromCaption(text,project);
  if(editor.composeTitle)text=[editor.title||project.title,text].filter(v=>v!=='').join('\n\n');
  const tags=tagsForPlatform(editor,plan.platform,s.defaultTags);
  if(tags)text=[text,tags].filter(Boolean).join('\n\n');
  const count=plan.platform==='instagram'?text.length+(text.match(/\n/g)?.length||0):text.length;
  const draftFallback=s.deliveryMode==='draft'&&plan.platform==='instagram'&&plan.issues.some(x=>x.startsWith('Instagram photo is outside'));
  const issues=plan.issues.filter(x=>!x.startsWith('Caption exceeds')&&!(draftFallback&&x.startsWith('Instagram photo is outside')));
  if(count>{instagram:2196,facebook:5000,tiktok:4000}[plan.platform])issues.push('Текст перевищує ліміт платформи; автоматичного обрізання немає');
  if(plan.images.length>s.platforms[plan.platform].maxPhotos)issues.push('Фото більше за встановлений ліміт; виберіть потрібні фото вручну');
  return {...plan,issues:[...new Set(issues)],warnings:[...plan.warnings,...(draftFallback?['Instagram: original photo aspect ratio requires notification/manual completion; saved as a draft without cropping.']:[])],
    input:{...plan.input,...(plan.platform==='tiktok'&&editor.title?{metadata:{...plan.input.metadata,tiktok:{...plan.input.metadata.tiktok,title:editor.title}}}:{}),...(draftFallback?{schedulingType:'notification'}:{}),text,saveToDraft:s.deliveryMode==='draft'}};
}
