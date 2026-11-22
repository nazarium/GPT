import test from 'node:test';
import assert from 'node:assert/strict';
import {siteImageFetcher,inspectGallery} from '../media.mjs';
import {imageResponse} from './helpers.mjs';
test('Worker checks static originals through ASSETS without route self-fetch and preserves Range',async()=>{
 let assetCalls=0,networkCalls=0;
 const env={ASSETS:{async fetch(request){assetCalls++;assert.equal(request.headers.get('Range'),'bytes=0-65535');assert.equal(new URL(request.url).pathname,'/assets/projects/123/1.png');return imageResponse();}}};
 const result=await inspectGallery({images:['https://archi-create.com.ua/assets/projects/123/1.png']},siteImageFetcher(env,()=>{networkCalls++;throw Error('self-fetch unavailable');}));
 assert.equal(result[0].width,1000);assert.equal(assetCalls,1);assert.equal(networkCalls,0);
});
test('uploaded originals use PortfolioStore rather than static assets or network',async()=>{
 let calls=0;
 const env={ASSETS:{fetch(){throw Error('wrong storage');}},PORTFOLIO:{idFromName(name){assert.equal(name,'archi-create');return 'store';},get(id){assert.equal(id,'store');return {async fetch(request){calls++;assert.match(request.url,/cloud/);return imageResponse();}};}}};
 const result=await inspectGallery({images:['https://archi-create.com.ua/assets/projects/cloud/12345678-1234-1234-1234-123456789abc.png']},siteImageFetcher(env,()=>{throw Error('network');}));
 assert.equal(result[0].width,1000);assert.equal(calls,1);
});
test('binding image fetch rejects foreign hosts and non-image paths',async()=>{
 const fetcher=siteImageFetcher({ASSETS:{fetch(){throw Error('must not run');}}});
 for(const url of ['https://other.example/assets/projects/123/1.png','https://archi-create.com.ua/admin','https://archi-create.com.ua/assets/projects/123/1.png?x=1'])
  await assert.rejects(fetcher(url,{}),/Invalid original/);
});

test('missing size headers are measured without confusing partial and total size',async()=>{
 let calls=0;
 const bytes=new Uint8Array(100000);bytes.set([137,80,78,71,13,10,26,10]);const view=new DataView(bytes.buffer);view.setUint32(16,1000);view.setUint32(20,800);
 const fetcher=async(url,init)=>{
  calls++;
  return new Response(init.headers?bytes.slice(0,65536):bytes,{status:init.headers?206:200,headers:{'Content-Type':'image/png'}});
 };
 const result=await inspectGallery({images:['https://archi-create.com.ua/assets/projects/123/1.png']},fetcher);
 assert.equal(calls,2);assert.equal(result[0].size,100000);assert.equal(result[0].width,1000);
});
test('unknown-length full images are counted and stop above the safe size cap',async()=>{
 let reads=0;
 const first=new Uint8Array(1024*1024);first.set([137,80,78,71,13,10,26,10]);const view=new DataView(first.buffer);view.setUint32(16,1000);view.setUint32(20,800);
 const result=await inspectGallery({images:['https://archi-create.com.ua/assets/projects/123/1.png']},async()=>new Response(new ReadableStream({pull(controller){reads++;controller.enqueue(first);if(reads===20)controller.close();}}),{headers:{'Content-Type':'image/png'}}));
 assert.ok(result[0].size>8*1024*1024);assert.ok(reads<20);
});
