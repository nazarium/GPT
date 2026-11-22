import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
test('real workerd rejects old redirect option and accepts Buffer/media requests after fix',async()=>{
  const code=await readFile(new URL('../buffer.mjs',import.meta.url),'utf8');
  const media=await readFile(new URL('../media.mjs',import.meta.url),'utf8');
  const entry=`import {bufferRequest,GET_CHANNELS} from './buffer.mjs';
    import {inspectImage} from './media.mjs';
    export default {async fetch(){
      let oldRejected=false;
      try {new Request('https://api.buffer.com',{redirect:'error'});} catch {oldRejected=true;}
      const data=await bufferRequest({BUFFER_API_KEY:'test'},GET_CHANNELS,{},async(url,init)=>{
        const request=new Request(url,init);if(request.redirect!=='manual')throw Error('redirect mode');
        return Response.json({data:{channels:[{id:'test'}]}});
      });
      const image=await inspectImage('https://archi-create.com.ua/assets/projects/123/1.png',async(url,init)=>{
        const request=new Request(url,init);if(request.redirect!=='manual')throw Error('redirect mode');
        const b=new Uint8Array(40);b.set([137,80,78,71,13,10,26,10]);const v=new DataView(b.buffer);v.setUint32(16,1000);v.setUint32(20,800);
        return new Response(b,{headers:{'Content-Type':'image/png','Content-Length':'40'}});
      });
      return Response.json({oldRejected,channels:data.channels.length,width:image.width});
    }};`;
  const path=name=>fileURLToPath(new URL(name,import.meta.url));
  const mf=new Miniflare(convertV4MiniflareOptions({name:'buffer-runtime-test',compatibilityDate:'2026-11-03',modules:[
    {type:'ESModule',path:path('runtime-entry.mjs'),contents:entry},
    {type:'ESModule',path:path('buffer.mjs'),contents:code},
    {type:'ESModule',path:path('media.mjs'),contents:media},
  ]}));
  try {const response=await mf.dispatchFetch('http://localhost/');assert.equal(response.status,200);assert.deepEqual(await response.json(),{oldRejected:true,channels:1,width:1000});}
  finally {await mf.dispose();}
});
