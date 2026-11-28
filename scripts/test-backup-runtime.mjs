import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHmac} from 'node:crypto';
import {importBackup} from '../src/import-backup.mjs';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=createRequire(require.resolve('wrangler/package.json'))('miniflare');
const result=await build({stdin:{resolveDir:process.cwd(),sourcefile:'backup-runtime-entry.mjs',contents:`
import site, {PortfolioStore} from './cloudflare/worker.mjs';
export class BackupFixture extends PortfolioStore {
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/seed'){
   for(let i=0;i<220;i++)await this.ctx.storage.put('photo:'+String(i).padStart(4,'0'),new Uint8Array(96*1024).fill(i%256));
   return new Response('seeded');
  }
  if(path==='/modify'){
   await this.ctx.storage.put('obsolete',true);
   await this.ctx.storage.delete('photo:0100');
   return new Response('ok');
  }
  if(path==='/verify')return Response.json({obsolete:!!await this.ctx.storage.get('obsolete'), photo:new Uint8Array(await this.ctx.storage.get('photo:0100'))[0]});
  if(path.startsWith('/api/'))return super.fetch(request);
  return new Response('healthy');
 }
}
export default {async fetch(r,env,ctx){if(new URL(r.url).pathname.startsWith('/api/'))return site.fetch(r,env,ctx);return env.PORTFOLIO.get(env.PORTFOLIO.idFromName('archi-create')).fetch(r);}};
`},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-11-03',bindings:{ADMIN_PASSWORD:'test-runtime-password-for-backups',BACKUP_SIGNING_KEY:'independent-test-backup-key'},durableObjects:{PORTFOLIO:{className:'BackupFixture',useSQLite:true}}}));
const headers = {Authorization: 'Basic '+Buffer.from('admin:test-runtime-password-for-backups').toString('base64'), Origin:'http://localhost'};
const download = () => mf.dispatchFetch('http://localhost/api/admin/home/backup',{headers});
const api = async (path,options) => {
 const response = await mf.dispatchFetch('http://localhost/api/admin/'+path,{...options,headers:{...options.headers,...headers}});
 const result = await response.json();
 if (!response.ok) throw Error(result.error);
 return result;
};
try{
 assert.equal((await mf.dispatchFetch('http://localhost/seed')).status,200);
 const response=await download();assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);
 const text=await response.text();assert.ok(Buffer.byteLength(text)>20*1024*1024);
 const backup=JSON.parse(text);assert.deepEqual(backup.signature,[...createHmac('sha256','independent-test-backup-key').update(backup.payload).digest()]);
 const entries=JSON.parse(backup.payload).entries;assert.equal(entries.filter(([key])=>key.startsWith('photo:')).length,220);
 await mf.dispatchFetch('http://localhost/modify');
 const state = async()=> (await mf.dispatchFetch('http://localhost/verify')).json();
 await assert.rejects(()=>importBackup(new Blob([text.slice(0,600000)]),api));
 assert.deepEqual(await state(),{obsolete:true});
 const corrupt = {...backup,signature:[backup.signature[0]^1,...backup.signature.slice(1)]};
 await assert.rejects(()=>importBackup(new Blob([JSON.stringify(corrupt)]),api),/Підпис/);
 assert.deepEqual(await state(),{obsolete:true});
 const result=await importBackup(new Blob([text]),api);
 assert.equal(result.entries, entries.length);
 assert.deepEqual(await state(),{obsolete:false,photo:100});
 const restoredEnvelope=await (await download()).json();
 const restoredEntries=new Map(JSON.parse(restoredEnvelope.payload).entries);
 assert.deepEqual(restoredEntries,new Map(entries));
 const legacy={payload:backup.payload,signature:[...createHmac('sha256','test-runtime-password-for-backups').update(backup.payload).digest()]};
 await importBackup(new Blob([JSON.stringify(legacy)]),api);
 assert.deepEqual(await state(),{obsolete:false,photo:100});

 const canceled=await download();await canceled.body.cancel();
 assert.equal(await(await mf.dispatchFetch('http://localhost/health')).text(),'healthy');
 console.log('Cloudflare runtime passed: '+(Buffer.byteLength(text)/1024/1024).toFixed(1)+' MiB streamed, 220 photo chunks, authenticated admin restore, all records identical, tamper rollback, cancellation.');
}finally{await mf.dispose();}
