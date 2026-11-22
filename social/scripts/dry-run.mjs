// Public GET requests only. This script never reads a Buffer key or sends a mutation.
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeCatalog,buildPost,fingerprint } from '../catalog.mjs';
import { inspectImage } from '../media.mjs';

const fileIndex=process.argv.indexOf('--catalog');
const outIndex=process.argv.indexOf('--out');
const output=outIndex>=0?process.argv[outIndex+1]:'work/social-dry-run.json';
const raw=fileIndex>=0?JSON.parse(await readFile(process.argv[fileIndex+1],'utf8'))
  :await (await fetch('https://archi-create.com.ua/api/projects',{redirect:'error',signal:AbortSignal.timeout(20000)})).json();
const catalog=normalizeCatalog(raw), media=new Map(), failures=[];
const urls=[...new Set(catalog.flatMap(p=>p.images))];
let offset=0;
await Promise.all(Array.from({length:3},async()=>{
  while(offset<urls.length) {
    const url=urls[offset++];
    try {media.set(url,await inspectImage(url));}
    catch(error){failures.push({url,error:error.message});}
  }
}));
const sampleChannels=[{platform:'instagram',id:'DRY_RUN_INSTAGRAM',mode:'automatic'},
  {platform:'facebook',id:'DRY_RUN_FACEBOOK',mode:'automatic'},
  {platform:'tiktok',id:'DRY_RUN_TIKTOK',mode:'notification'}];
const projects=await Promise.all(catalog.map(async p=>({id:p.id,title:p.title,description:p.description,photoCount:p.images.length,
  fingerprint:await fingerprint(p),media:p.images.map(url=>media.get(url)||{url,error:'unavailable'}),
  plans:sampleChannels.map(c=>{
    const plan=buildPost(p,c,{},p.images.map(url=>media.get(url)||{url}));
    return {...plan,mediaVerified:p.images.every(url=>media.has(url)),input:{...plan.input,dueAt:'REVIEW_BEFORE_SCHEDULING'}};
  })})));
const result={checkedAt:new Date().toISOString(),source:fileIndex>=0?process.argv[fileIndex+1]:'https://archi-create.com.ua/api/projects',
  mode:'dry-run',bufferRequests:0,bufferMutations:0,projectsCount:projects.length,photos:urls.length,
  descriptions:projects.filter(p=>p.description).length,failures,
  summary:Object.fromEntries(sampleChannels.map(c=>[c.platform,{
    passesStaticChecks:projects.filter(p=>!p.plans.find(x=>x.platform===c.platform).issues.length).length,
    needsReview:projects.filter(p=>p.plans.find(x=>x.platform===c.platform).issues.length).length,
    publishingMode:c.mode,
  }])),projects};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,projects:undefined,failures:failures.length},null,2));
