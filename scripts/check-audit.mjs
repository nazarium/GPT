import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=createRequire(require.resolve('wrangler/package.json'))('miniflare');
const result=await build({stdin:{contents:`import worker from './cloudflare/worker.mjs';
import {sanitizeArticleHtml} from './cloudflare/article-html.mjs';
export default {async fetch(){
 const results=[];
 for(const tag of ['textarea','title','xmp','noembed','noframes','noscript','plaintext','listing']) {
  const output=await sanitizeArticleHtml('<p>Safe</p><'+tag+'><img src=x onerror=alert(1)></'+tag+'>',true);
  if(/onerror|<img/i.test(output))throw Error('Unsafe '+tag+': '+output);
  results.push(tag);
 }
 const clean=await sanitizeArticleHtml('<h2>Title</h2><p><a href="https://example.com">Link</a><span class="article-accent">Text</span></p>');
 if(!clean.includes('<h2>Title</h2>')||!clean.includes('article-accent'))throw Error('Legitimate content lost');
 const context={waitUntil(){}};
 const original=worker.handle;
 worker.handle=async (r,e,c)=>{if(c!==context)throw Error('Context lost');return new Response('OK')};
 const response=await worker.fetch(new Request('https://example.com'),{},context);
 const head=await original.call(worker,new Request('https://example.com',{method:'HEAD'}),{},context);
 if(head.body!==null)throw Error('HEAD response has a body');
 worker.handle=original;
 return Response.json({results,csp:response.headers.get('Content-Security-Policy'),nosniff:response.headers.get('X-Content-Type-Options')});
}};`,resolveDir:process.cwd(),sourcefile:'audit-test-entry.mjs'},external:['cloudflare:workers'],bundle:true,write:false,format:'esm',platform:'browser'});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-11-03'}));
try{const r=await mf.dispatchFetch('http://localhost');const data=await r.json();assert.equal(data.results.length,8);assert.equal(data.nosniff,'nosniff');assert.match(data.csp,/frame-ancestors 'self'/);assert.match(data.csp,/script-src 'self'/);console.log('Audit runtime checks passed: sanitizer, legitimate markup, context, security headers');}finally{await mf.dispose();}

