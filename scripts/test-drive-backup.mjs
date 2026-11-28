import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash, createHmac} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {verifyFullBackup} from './verify-full-backup.mjs';
const require = createRequire(import.meta.url);
const {Miniflare, convertV4MiniflareOptions} = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const source = [
  "import {uploadFile} from './cloudflare/drive-backup.mjs';",
  "export default {async fetch() {",
  "const results=[];",
  "for(const length of [0,31,4194304,4194321,8388608]) {",
  "const bytes=new Uint8Array(length).fill(71);",
  "const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');",
  "let stored=0, lost=false, completed=false;",
  "const metadata=()=>Response.json({id:'file',size:String(length),sha256Checksum:hash});",
  "const mock=async(url,options)=>{",
  "if(url.includes('uploadType='))return new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/test'}});",
  "const range=options.headers['Content-Range'];",
  "if(range.startsWith('bytes */')){if(length===0)completed=true;return completed?metadata():new Response(null,{status:308,headers:stored?{Range:'bytes=0-'+(stored-1)}:{}});}",
  "const match=/bytes (\\d+)-(\\d+)\\/(.*)/.exec(range);",
  "if(Number(match[1])!==stored)throw Error('Duplicate or skipped bytes');",
  "const chunk=options.body;",
  "for(let i=0;i<chunk.length;i++)if(chunk[i]!==71)throw Error('Corrupted chunk');",
  "stored+=chunk.length; completed=match[3]!=='*';",
  "if(!lost){lost=true;throw Error('Lost response after successful write');}",
  "return completed?metadata():new Response(null,{status:308,headers:{Range:'bytes=0-'+(stored-1)}});",
  "};",
  "const file=await uploadFile('test','folder','file',new Blob([bytes]).stream(),mock);",
  "if(file.size!==length||stored!==length)throw Error('Wrong final size');",
  "results.push(length);",
  "}",
  "return Response.json(results);}};",
].join('\n');
const result = await build({stdin: {contents: source, resolveDir: process.cwd(), sourcefile: 'drive-backup-test.mjs'}, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers']});
const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script: result.outputFiles[0].text, compatibilityDate: '2026-11-03'}));
try {
  const response = await mf.dispatchFetch('https://test/');
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), [0,31,4194304,4194321,8388608]);
} finally { await mf.dispose(); }

const directory = '.build/drive-verify-test';
await mkdir(directory, {recursive: true});
const files = [];
for (const [name, path, body] of [['content.json','content.json','test content'],['social.sql','social.sql','CREATE TABLE test(id INTEGER);'],['00000-photo.png','static/assets/photo.png','test image']]) {
  await writeFile(directory + '/' + name, body);
  files.push({name, path, size: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex')});
}
const payload = JSON.stringify({format: 'archi-create-full-v1', commit: 'test-commit', files});
await writeFile(directory + '/manifest.json', JSON.stringify({payload, signature: createHmac('sha256','test-key').update(payload).digest('hex')}));
assert.equal((await verifyFullBackup(directory, 'test-key')).files.length, 3);
await assert.rejects(() => verifyFullBackup(directory, 'wrong-key'), /Підпис/);
await writeFile(directory + '/social.sql', 'tampered');
await assert.rejects(() => verifyFullBackup(directory, 'test-key'), /розмір|Пошкоджено/);
console.log('Drive backup passed: bounded chunks, exact boundaries, lost upload responses, manifest verification, tamper rejection.');
