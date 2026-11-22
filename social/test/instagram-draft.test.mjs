import test from 'node:test';
import assert from 'node:assert/strict';
import {raw,channel} from './helpers.mjs';
import {normalizeCatalog,buildPost} from '../catalog.mjs';
import {defaults,applyCaption} from '../settings.mjs';

const project=()=>normalizeCatalog([{...raw(),images:Array.from({length:9},(_,i)=>'assets/projects/123/'+(i+1)+'.png')}])[0];
const media=p=>p.images.map((url,i)=>({url,width:1400,height:i===7?637:i===8?700:788,size:500000}));
test('wide Instagram originals become a notification draft with all nine original URLs intact',()=>{
 const p=project(),plan=applyCaption(buildPost(p,channel,{},media(p)),p,defaults());
 assert.equal(plan.issues.length,0);assert.equal(plan.input.saveToDraft,true);assert.equal(plan.input.schedulingType,'notification');
 assert.equal(plan.images.length,9);assert.deepEqual(plan.input.assets.map(a=>a.image.url),p.images);
 assert.ok(plan.warnings.some(w=>w.includes('without cropping')));
});
test('scheduled automatic publishing keeps the aspect ratio barrier',()=>{
 const p=project(),plan=applyCaption(buildPost(p,channel,{},media(p)),p,{...defaults(),deliveryMode:'schedule'});
 assert.ok(plan.issues.some(i=>i.startsWith('Instagram photo is outside')));
 assert.equal(plan.input.saveToDraft,false);assert.equal(plan.input.schedulingType,'automatic');
});
test('aspect ratio fallback does not bypass file size or photo count limits',()=>{
 const p=project(),m=media(p);m[0].size=9*1024*1024;const s=defaults();s.platforms.instagram.maxPhotos=8;
 const plan=applyCaption(buildPost(p,channel,{},m),p,s);
 assert.ok(plan.issues.some(i=>i.includes('8MB')));assert.ok(plan.issues.some(i=>i.includes('ліміт')));assert.equal(plan.input.assets.length,9);
});
