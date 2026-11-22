import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';

export function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).sort())sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  function prepared(sql,args=[]) {
    const invoke=()=>{
      const stmt=sqlite.prepare(sql);
      if (/^\s*(?:SELECT|WITH)/i.test(sql)) return {results:stmt.all(...args),meta:{changes:0}};
      const result=stmt.run(...args); return {results:[],meta:{changes:Number(result.changes)}};
    };
    return {bind:(...v)=>prepared(sql,v),all:async()=>invoke(),run:async()=>invoke(),first:async()=>invoke().results[0]??null,_invoke:invoke};
  }
  return {prepare:prepared,batch:async statements=>{
    sqlite.exec('BEGIN');
    try {const results=statements.map(s=>s._invoke());sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  },close:()=>sqlite.close(),sqlite};
}
export const raw=(id='123',number='01')=>({id,title:'Тестовий будинок',number,images:[`assets/projects/${id}/1.png`],description:'Опис із сайту'});
export function png(width=1000,height=800) {
  const bytes=new Uint8Array(40),view=new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10]);view.setUint32(16,width);view.setUint32(20,height);
  return bytes;
}
export const imageResponse=()=>new Response(png(),{headers:{'Content-Type':'image/png','Content-Length':'40'}});
export const channel={platform:'instagram',id:'ig',mode:'automatic'};
