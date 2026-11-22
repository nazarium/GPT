export function formatTags(value='') {
 if(typeof value!=='string'||value.length>1000)throw new Error('Теги мають бути текстом до 1000 символів');
 const tags=value.split(/[\s,;]+/u).filter(Boolean).map(tag=>tag.replace(/^#+/,''));
 if(tags.some(tag=>!tag||! /^[\p{L}\p{M}\p{N}_]+$/u.test(tag)))throw new Error('У тегах дозволені літери, цифри та підкреслення; розділяйте теги пробілами або комами');
 return [...new Map(tags.map(tag=>[tag.toLocaleLowerCase('uk'),tag])).values()].map(tag=>'#'+tag).join(' ');
}
export function tagsForPlatform(editor,platform,defaultTags='') {
 return formatTags(editor.useCommonTags===false?editor.platformTags?.[platform]??defaultTags:editor.commonTags??defaultTags);
}
export function validateEditorOptions(input) {
 if(input===undefined)return undefined;
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Некоректні параметри допису');
 const allowed=['title','composeTitle','useCommonCaption','commonCaption','dueAt','useCommonTags','commonTags','platformTags'],result={};
 for(const key of Object.keys(input))if(!allowed.includes(key))throw new Error('Невідомий параметр допису');
 if(input.title!==undefined) {
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>200)throw new Error('Назва має містити від 1 до 200 символів');
  result.title=input.title;
 }
 for(const key of ['composeTitle','useCommonCaption','useCommonTags'])if(input[key]!==undefined) {
  if(typeof input[key]!=='boolean')throw new Error('Некоректний перемикач опису');result[key]=input[key];
 }
 if(input.commonCaption!==undefined) {
  if(typeof input.commonCaption!=='string'||input.commonCaption.length>5000)throw new Error('Спільний опис перевищує ліміт');
  result.commonCaption=input.commonCaption;
 }
 if(input.commonTags!==undefined){formatTags(input.commonTags);result.commonTags=input.commonTags;}
 if(input.platformTags!==undefined) {
  if(!input.platformTags||typeof input.platformTags!=='object'||Array.isArray(input.platformTags))throw new Error('Некоректні теги платформ');
  result.platformTags={};
  for(const [platform,value] of Object.entries(input.platformTags)) {
   if(!['instagram','facebook','tiktok'].includes(platform))throw new Error('Невідома платформа тегів');
   formatTags(value);result.platformTags[platform]=value;
  }
 }
 if(input.dueAt!==undefined) {
  if(input.dueAt===null)result.dueAt=null;
  else {const d=new Date(input.dueAt);if(typeof input.dueAt!=='string'||!Number.isFinite(+d))throw new Error('Некоректна дата чернетки');result.dueAt=d.toISOString();}
 }
 if(result.useCommonCaption) {
  const text=[result.composeTitle?result.title:'',result.commonCaption||'',tagsForPlatform(result,'instagram')].filter(v=>v!=='').join('\n\n');
  if(text.length+(text.match(/\n/g)?.length||0)>2196)throw new Error('Спільний опис із назвою перевищує ліміт Instagram');
 }
 return result;
}
export function descriptionFromCaption(text,project,title) {
 const headings=[title,project.title+(project.number?' — '+project.number:''),project.title].filter(Boolean);
 for(const heading of headings) {
  if(text===heading)return '';
  if(text.startsWith(heading+'\n'))return text.slice(heading.length).replace(/^\n{1,2}/,'');
 }
 return text;
}
