import { describeConnection } from '../social/connection.mjs';
import { BufferKeyEditor } from './BufferKeyEditor.jsx';
import { selectedImageIndexes } from '../social/catalog.mjs';
import { submitSelected,deliveryDisabledReason } from '../social/bulk.mjs';
import { descriptionFromCaption,tagsForPlatform } from '../social/editor-options.mjs';
import { useEffect,useState } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges.js';
const labels={instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok'};
const stateNames={pending:'Очікує',sending:'Надсилається',retry:'Відкладено',blocked:'Потрібна перевірка',uncertain:'Результат невідомий',scheduled:'Заплановано',manual_required:'Потрібне ручне завершення',sent:'Опубліковано',failed:'Помилка',draft:'Чернетка',saving:'Створюється'};
const eventNames={publication_saved:'Публікацію збережено',buffer_draft_created:'Створено чернетку Buffer',settings_changed:'Змінено налаштування',ready:'Готовність підтверджено',paused:'Відправлення призупинено',activated:'Відправлення дозволено',created:'Buffer прийняв допис',status:'Оновлено статус',attempt:'Спроба відправлення',adopted:'Знайдено попередній допис',refreshed:'Статус перевірено','manual-completed':'Ручне завершення підтверджено'};
function PlatformName({platform}) {
  return <span className="social-platform-name"><svg className={'social-platform-icon '+platform} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {platform==='instagram'?<><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></>:platform==='facebook'?<path fill="currentColor" d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.62.77-1.62 1.56V12h2.77l-.44 2.89h-2.33v6.99A10 10 0 0 0 22 12Z"/>:<path fill="currentColor" d="M16.6 2c.3 2.5 1.7 4 4.4 4.2v3.3a9.4 9.4 0 0 1-4.4-1.4v7.4a6.4 6.4 0 1 1-5.5-6.3v3.4a3.1 3.1 0 1 0 2.2 3V2h3.3Z"/>}
  </svg>{labels[platform]}</span>;
}
function ToolbarIcon({name}) {
 const paths={queue:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z',connection:'m9 15 6-6M7 17l-1 1a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0M17 7l1-1a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-5 0',events:'M6 3h13v18H6a3 3 0 0 1 0-6h13M6 3a3 3 0 0 0-3 3v12M9 7h6M9 11h6',refresh:'M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5',play:'m8 4 12 8-12 8V4Z',pause:'M8 4v16M16 4v16'};
 return <svg className="social-toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[name]}/>{name==='settings'&&<circle cx="12" cy="12" r="3"/>}</svg>;
}
function BufferLabel({text}) {
 return text.split('Buffer').map((part,i)=><span key={i}>{i>0&&<span className="social-buffer-brand"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1 0 7l12 6 12-6L12 1Zm-9.6 9.8L0 12l12 6 12-6-2.4-1.2L12 15.6l-9.6-4.8Zm0 5L0 17l12 6 12-6-2.4-1.2L12 20.6l-9.6-4.8Z"/></svg>Buffer</span>}{part}</span>);
}
const clone=x=>JSON.parse(JSON.stringify(x));
const localDate=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const formatDate=(value,timezone)=>value?new Intl.DateTimeFormat('uk-UA',{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(value)):'—';
function Download({value,name,children}) {return <button type="button" onClick={()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}}>{children}</button>;}
function UnsavedSettingsNotice() {
  const [visible,setVisible]=useState(true),[leaving,setLeaving]=useState(false);
  useEffect(()=>{
    const fade=setTimeout(()=>setLeaving(true),7500);
    const hide=setTimeout(()=>setVisible(false),8000);
    return()=>{clearTimeout(fade);clearTimeout(hide);};
  },[]);
  if(!visible)return null;
  return <div className={'social-toast social-unsaved-toast'+(leaving?' is-leaving':'')}>
    <p role="status">Є незбережені налаштування. Збережіть або скасуйте їх на вкладці «Налаштування». Перегляд і дії з проєктами використовують збережену версію.</p>
    <button type="button" aria-label="Закрити попередження" onClick={()=>setVisible(false)}>×</button>
  </div>;
}
export function SocialEditor({api}) {
  const [data,setData]=useState(null),[settings,setSettings]=useState(null),[tab,setTab]=useState('queue');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[dirty,setDirty]=useState(false);
  const [activation,setActivation]=useState('');
  const [preflight,setPreflight]=useState({key:'',loading:false,results:{}}),[preflightRevision,setPreflightRevision]=useState(0);
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[selected,setSelected]=useState(''),[bulk,setBulk]=useState([]);
  const [preview,setPreview]=useState(null),[selection,setSelection]=useState({}),[dueAt,setDueAt]=useState(localDate(Date.now()+86400000));
  const [captions,setCaptions]=useState({}),[projectEdits,setProjectEdits]=useState({});
  const [editor,setEditor]=useState({title:'',composeTitle:true,useCommonCaption:true,commonCaption:'',useCommonTags:true,commonTags:'',platformTags:{},dueAt:null});
  const [connectionError,setConnectionError]=useState(''),[connectionCheckedAt,setConnectionCheckedAt]=useState(null);
  const [connection,setConnection]=useState(null),[remoteDrafts,setRemoteDrafts]=useState(null),[cursor,setCursor]=useState(null),[detail,setDetail]=useState(null);
  useUnsavedChanges(dirty||busy||Object.keys(projectEdits).length>0);
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),8000);return()=>clearTimeout(timer);},[message]);
  const post=(action,body={})=>api('social/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  async function load() {const result=await api('social/dashboard');setData(result);return result;}
  useEffect(()=>{let cancelled=false;api('social/dashboard').then(result=>{if(!cancelled){setData(result);setSettings(clone(result.settings));}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[]);
  useEffect(()=>{if(busy||!data?.live||data.settings.archiveEnabled)return;let cancelled=false;const timer=setInterval(()=>{api('social/dashboard').then(result=>{if(!cancelled)setData(result);}).catch(()=>{});},5000);return()=>{cancelled=true;clearInterval(timer);};},[busy,data?.live,data?.settings.archiveEnabled]);
  async function run(action) {setBusy(true);setError('');setMessage('');try{await action();}catch(e){setError(e.message||'Не вдалося виконати дію');}finally{setBusy(false);}}
  function changeSettings(key,value) {setSettings(s=>({...s,[key]:value}));setDirty(true);}
  function changePlatform(platform,key,value) {setSettings(s=>({...s,platforms:{...s.platforms,[platform]:{...s.platforms[platform],[key]:value}}}));setDirty(true);}
  async function toggleDelivery() {
    if(!data.live&&data.settings.deliveryMode!=='draft') {
      setTab('settings');setMessage('Для відновлення планування відкрийте «Окрема активація відправлення» та підтвердьте дозвіл.');return;
    }
    await run(async()=>{
      await post(data.live?'pause':'resume',data.live?{}:{settingsRevision:data.settings.revision,confirm:'APPROVE_DRAFT_DELIVERY'});
      const result=await load();
      setMessage(result.live?'Передачу чернеток відновлено.'+(result.settings.archiveEnabled?' Архів обробляється за графіком.':' Готова черга починає оброблятися одразу.'):'Нові надсилання зупинені. Уже заплановані дописи залишаються в Buffer.');
    });
  }
  function changeSelection(platform,indexes) {
    const next={...selection,[platform]:indexes};setSelection(next);
    setProjectEdits(v=>({...v,[selected]:{selection:next,captions,options:editor}}));
  }
  function changeCaption(platform,text) {
    const next={...captions,[platform]:text};setCaptions(next);
    setProjectEdits(v=>({...v,[selected]:{selection,captions:next,options:editor}}));
  }
  function changeEditor(key,value) {
    const next={...editor,[key]:value};setEditor(next);
    setProjectEdits(v=>({...v,[selected]:{selection,captions,options:next}}));
  }
  function changeDueDate(value) {
    setDueAt(value);
    changeEditor('dueAt',value?new Date(value).toISOString():null);
  }
  async function openProject(row) {
    await run(async()=>{
      const result=await api('social/preview?id='+encodeURIComponent(row.id)),edited=projectEdits[row.id];
      const stored=result.options||{},legacyTitle=result.project.title+(result.project.number?' — '+result.project.number:''),title=stored.title&&stored.title!==legacyTitle?stored.title:result.project.title;
      const descriptions=Object.fromEntries(result.plans.map(p=>{
        const tags=tagsForPlatform(stored,p.platform,data.settings.defaultTags),body=tags&&p.input.text.endsWith('\n\n'+tags)?p.input.text.slice(0,-tags.length-2):p.input.text;
        return [p.platform,stored.composeTitle&&Object.hasOwn(result.captions||{},p.platform)?result.captions[p.platform]:descriptionFromCaption(body,result.project,stored.composeTitle?title:undefined)];
      }));
      const options=edited?.options??{...stored,title,composeTitle:true,useCommonCaption:stored.useCommonCaption??true,useCommonTags:stored.useCommonTags??true,commonTags:stored.commonTags??data.settings.defaultTags??'',platformTags:stored.platformTags??Object.fromEntries(Object.keys(labels).map(p=>[p,data.settings.defaultTags??''])),commonCaption:stored.commonCaption??descriptions.instagram??Object.values(descriptions)[0]??'',dueAt:stored.dueAt??new Date(Date.now()+86400000).toISOString()};
      setPreview(result);setSelection(clone(edited?.selection??result.selection??row.selection));
      setCaptions(clone(edited?.captions??descriptions));setEditor(clone(options));setDueAt(options.dueAt?localDate(options.dueAt):'');
      setSelected(row.id);
    });
  }
  function submissionFor(row) {
    const edited=row.id===selected?{selection,captions,options:editor}:projectEdits[row.id]||{selection:row.selection,captions:row.captions||{},options:row.options||{}};
    return {id:row.id,fingerprint:row.id===selected?preview.fingerprint:row.fingerprint,
      settingsRevision:row.id===selected?preview.settingsRevision:data.settings.revision,...edited};
  }
  async function submitProject(row) {
    const result=await post('submit',submissionFor(row));
    setProjectEdits(v=>{const next={...v};delete next[row.id];return next;});
    return result;
  }
  async function submitBulk() {
    if(!preflightReady)throw new Error('Дочекайтеся перевірки й виправте проблеми вибраних проєктів.');
    const result=await submitSelected(bulk,sourceRows,submitProject,id=>setBulk(v=>v.filter(value=>value!==id)));
    await load();
    const failed=result.failed.map(f=>`${sourceRows.find(p=>p.id===f.id)?.project.title||f.id}: ${f.error}`).join('; ');
    setMessage('Передано в чергу чернеток: '+result.succeeded.length+'. '+(result.failed.length?'Не передано: '+result.failed.length+'. '+failed: data.live?'Обробка відбувається згідно з налаштуваннями.':'Відправлення на паузі.'));
  }
  async function readDrafts(after) {
    const result=await api('social/drafts'+(after?'?after='+encodeURIComponent(after):''));
    const rows=result.edges.map(e=>e.node);
    setRemoteDrafts(current=>after?[...(current||[]),...rows].filter((p,i,a)=>a.findIndex(v=>v.id===p.id)===i):rows);
    setCursor(result.pageInfo.hasNextPage?result.pageInfo.endCursor:null);
  }
  const sourceRows=data?.projects||[], row=sourceRows.find(p=>p.id===selected);
  const draftProjectIds=new Set(data?.drafts.map(draft=>draft.project_id));
  const matches=sourceRows.filter(p=>(p.project.title+' '+p.project.number+' '+p.project.label).toLocaleLowerCase('uk').includes(search.toLocaleLowerCase('uk'))).filter(p=>{
    return filter==='all'||filter==='draft'&&draftProjectIds.has(p.id)||filter==='inactive'&&!p.active;
  });
  const preflightRequests=data?bulk.map(id=>sourceRows.find(p=>p.id===id)).filter(Boolean).map(submissionFor):[];
  const preflightKey=JSON.stringify([preflightRevision,dirty,preflightRequests,data?.publications.map(p=>[p.project_id,p.platform,p.state]),data?.drafts.map(d=>[d.project_id,d.platform,d.state])]);
  useEffect(()=>{
    if(!bulk.length||!data||dirty)return;
    const controller=new AbortController();let cancelled=false;
    const timer=setTimeout(async()=>{
      setPreflight({key:preflightKey,loading:true,results:{}});let cursor=0;
      const worker=async()=>{while(cursor<preflightRequests.length&&!cancelled){const input=preflightRequests[cursor++];let result;
        try{result=await api('social/preflight',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal});}
        catch(error){result={projectId:input.id,ready:false,issues:[{platform:null,reason:'Перевірка не вдалася: '+error.message}]};}
        if(!cancelled)setPreflight(v=>v.key===preflightKey?{...v,results:{...v.results,[input.id]:result}}:v);
      }};
      await Promise.all(Array.from({length:Math.min(3,preflightRequests.length)},worker));
      if(!cancelled)setPreflight(v=>v.key===preflightKey?{...v,loading:false}:v);
    },350);
    return()=>{cancelled=true;controller.abort();clearTimeout(timer);};
  },[preflightKey]);
  const currentChecks=preflight.key===preflightKey?preflight.results:{};
  const checkedCount=Object.keys(currentChecks).length,readyCount=Object.values(currentChecks).filter(p=>p.ready).length,attentionCount=checkedCount-readyCount;
  const checking=bulk.length>0&&(preflight.key!==preflightKey||preflight.loading||checkedCount!==bulk.length);
  const preflightReady=bulk.length>0&&!dirty&&!checking&&attentionCount===0;
  if(!data||!settings)return <main className="editor social-editor"><h1>Соцмережі</h1>{error?<p className="editor-error" role="alert">{error}</p>:<p role="status">Завантаження черги…</p>}</main>;
  const readyProjects=sourceRows.filter(p=>p.active&&p.ready_hash===p.fingerprint);
  const tz=data.settings.timezone;
  const deliveryReason=deliveryDisabledReason(data,busy,dirty);
  const bulkReason=busy?'Триває обробка. Зачекайте.':dirty?'Спочатку збережіть або скасуйте налаштування.':!bulk.length?'Позначте проєкти прапорцями ліворуч у списку.':checking?'Дочекайтеся завершення перевірки.':attentionCount?'Виправте проблеми або зніміть вибір із проблемних проєктів.':'Передати вибрані проєкти в чернетки Buffer';
  return <main className="editor social-editor">
    <div className="social-heading"><div><p className="editor-kicker">ARCHI-CREATE / СОЦМЕРЕЖІ</p><h1>Соцмережі</h1><p className="editor-muted">Наявні проєкти й фотографії → Buffer → ваші акаунти в соцмережах.</p></div>
    </div>
    <div className="social-toolbar social-main-toolbar"><nav aria-label="Розділи соцмереж">{[['queue','Черга'],['drafts','Чернетки Buffer'],['settings','Налаштування'],['connection','Підключення'],['events','Журнал']].map(([id,text])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}>{id!=='drafts'&&<ToolbarIcon name={id}/>}<span>{text.includes('Buffer')?<BufferLabel text={text}/>:text}</span></button>)}</nav>
</div>
    {error&&<p className="editor-error social-feedback" role="alert">{error}</p>}
    <div className="social-toast-stack">
      {message&&<div className="social-toast"><p role="status">{message}</p><button type="button" aria-label="Закрити повідомлення" onClick={()=>setMessage('')}>×</button></div>}
      {dirty&&<UnsavedSettingsNotice key={tab}/>}
    </div>
    {busy&&<p className="editor-muted" role="status">Обробка… не закривайте сторінку.</p>}
    {tab==='queue'&&<>

      <div className="social-selection-summary"><span aria-live="polite">Вибрано: {bulk.length} / {sourceRows.filter(p=>p.active).length}</span><button type="button" title="Вибрати всі доступні проєкти поточного списку" disabled={busy||!matches.some(p=>p.active&&!bulk.includes(p.id))} onClick={()=>setBulk(v=>[...new Set([...v,...matches.filter(p=>p.active).map(p=>p.id)])])}>Вибрати все</button><button type="button" disabled={busy||!bulk.length} onClick={()=>setBulk([])}>Зняти вибір</button><button className="social-bulk-transfer" title={bulkReason} disabled={busy||!preflightReady} onClick={()=>run(submitBulk)}><BufferLabel text="Передати в чернетки Buffer"/></button><div className="social-toolbar-actions"><button type="button" disabled={busy} onClick={()=>run(async()=>{await post('sync');await load();setMessage('Каталог синхронізовано. Дописів не створено.');})}><ToolbarIcon name="refresh"/>Оновити каталог</button>
      <button type="button" title={deliveryReason||(data.live?'Зупинити нові передачі в Buffer':'Відновити передачу підготовленої черги в чернетки Buffer')} disabled={!!deliveryReason} onClick={toggleDelivery}><ToolbarIcon name={data.live?'pause':'play'}/>{data.live?'Пауза відправлення':'Відновити відправлення'}</button></div></div>
      {bulk.length>0&&<section className="social-preflight" aria-label="Перевірка масової передачі"><div className="social-preflight-heading"><p role="status">{dirty?'Збережіть або скасуйте зміни налаштувань.': `Готові: ${readyCount} · Потребують уваги: ${attentionCount}${checking?' · Перевірено '+checkedCount+' / '+bulk.length:''}`}</p><button type="button" disabled={busy||dirty||checking} onClick={()=>setPreflightRevision(v=>v+1)}>Перевірити знову</button></div><p className="editor-muted">Перевіряються поточні тексти, теги, вибір фото та обмеження ввімкнених платформ. Дописи не створюються.</p>{Object.values(currentChecks).some(p=>!p.ready)&&<ul>{Object.values(currentChecks).filter(p=>!p.ready).map(p=><li key={p.projectId}><strong>{sourceRows.find(r=>r.id===p.projectId)?.project.title||p.projectId}</strong>{p.issues.map((issue,i)=><span key={i}>{labels[issue.platform]||'Проєкт'}: {issue.reason}</span>)}</li>)}</ul>}</section>}
      <div className="social-workspace"><aside aria-label="Черга проєктів"><div className="social-project-search"><input aria-label="Пошук проєкту" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Назва, номер або тип об’єкта"/><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg></div><div className="social-project-filter"><label>Показати<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Усі проєкти</option><option value="draft">Є чернетки Buffer</option><option value="inactive">Приховані на сайті</option></select></label></div><p className="editor-muted">{matches.length} проєктів · фото не відкидаються автоматично</p><div className="social-project-list">{matches.map(p=><div key={p.id} className={'social-project-row '+(selected===p.id?'selected':'')}>
        <input aria-label={'Вибрати для передачі: '+p.project.title} type="checkbox" checked={bulk.includes(p.id)} disabled={busy||!p.active} onChange={e=>setBulk(v=>e.target.checked?[...v,p.id]:v.filter(id=>id!==p.id))}/>
        <button disabled={busy} aria-pressed={selected===p.id} onClick={()=>openProject(p)}><img loading="lazy" src={p.project.images[0]} alt=""/><span><strong>{p.project.title}</strong><small>№ {p.project.number} · {p.project.images.length} фото</small><small>{!p.active?'Приховано на сайті':'Доступний для передачі'}{draftProjectIds.has(p.id)?' · Є чернетки':''}</small>{p.saved_at&&p.options?.dueAt&&<small className="social-saved-date">{formatDate(p.options.dueAt,tz)}</small>}{bulk.includes(p.id)&&currentChecks[p.id]?.issues.map((issue,i)=><small className="social-preflight-issue" key={i}>{labels[issue.platform]||'Проєкт'}: {issue.reason}</small>)}</span></button>
      </div>)}</div></aside>
      <section className="social-panel" aria-label="Перегляд проєкту">{!preview||!row?<div className="social-empty"><h2>Виберіть проєкт</h2><p>Перевірте фотографії й підписи для соцмереж, потім натисніть «Передати в чернетки Buffer».</p></div>:<>
        <p className="editor-kicker">ПРОЄКТ № {preview.project.number}</p>
        <div className="social-project-actions"><label>Дата для нових чернеток · {Intl.DateTimeFormat().resolvedOptions().timeZone}<input type="datetime-local" value={dueAt} onChange={e=>changeDueDate(e.target.value)}/></label><button className="social-save-publication" type="button" aria-label="Зберегти публікацію" title="Зберегти публікацію без відправлення" disabled={busy||!row.active||!dueAt} onClick={()=>run(async()=>{
          await post('save',{id:row.id,fingerprint:preview.fingerprint,settingsRevision:preview.settingsRevision,selection,captions,options:editor,savedAt:row.saved_at});
          setProjectEdits(v=>{const next={...v};delete next[row.id];return next;});await load();setMessage('Публікацію збережено. Передачу в Buffer не запущено.');
        })}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M4 3h13l4 4v14H3V3h1ZM7 3v7h10V3M7 21v-7h10v7"/></svg></button><button className="editor-primary" type="button" disabled={busy||!row.active} onClick={()=>run(async()=>{await submitProject(row);await load();setMessage(data.live?'Проєкт передано в чергу чернеток Buffer.':'Проєкт додано в чергу. Відправлення на паузі.');})}><BufferLabel text="Передати в чернетки Buffer"/></button></div>
        <label className="social-title-field">Назва для соцмереж<input aria-label="Назва для соцмереж" value={editor.title} maxLength={200} onChange={e=>changeEditor('title',e.target.value)}/></label>
        <div className="social-common-fields">
        <section className="social-common-description"><label className="social-check"><input type="checkbox" checked={editor.useCommonCaption} onChange={e=>changeEditor('useCommonCaption',e.target.checked)}/>Один опис для всіх соцмереж</label>
          <label className={!editor.useCommonCaption?'social-caption-disabled':''}><textarea aria-label="Спільний опис" rows={3} maxLength={5000} disabled={!editor.useCommonCaption} value={editor.commonCaption} onChange={e=>changeEditor('commonCaption',e.target.value)}/></label>
        </section>
        <section className="social-common-description"><label className="social-check"><input type="checkbox" checked={editor.useCommonTags} onChange={e=>changeEditor('useCommonTags',e.target.checked)}/>Одні теги для всіх соцмереж</label>
          <label className={!editor.useCommonTags?'social-caption-disabled':''}><textarea aria-label="Спільні теги" rows={3} title="Розділяйте теги пробілами або комами. Символ # додається автоматично. Теги додаються в кінець опису." maxLength={1000} disabled={!editor.useCommonTags} value={editor.commonTags} placeholder="#архітектура #дизайн" onChange={e=>changeEditor('commonTags',e.target.value)}/></label>
        </section>
        </div>
        <div className="social-project-platforms">{preview.plans.map(plan=>{const indexes=selectedImageIndexes(preview.project,selection,plan.platform),tracked=data.drafts.find(d=>d.project_id===row.id&&d.platform===plan.platform),limit=data.settings.platforms[plan.platform].maxPhotos;return <section className="social-platform" key={plan.platform}>
          <div className="social-heading"><h3><PlatformName platform={plan.platform}/></h3></div>
          <p>Вибрано {indexes.length} із {preview.project.images.length} фото · ліміт {limit}</p>
          {['facebook','tiktok'].includes(plan.platform)&&preview.project.images.length>10&&selection[plan.platform]===undefined&&<p className="editor-muted">Автоматично вибрано перші 10 фото в порядку проєкту. Решта не відмічені. Добірку можна змінити вручну.</p>}
          {data.publications.filter(p=>p.project_id===row.id&&p.platform===plan.platform&&p.error).map(p=><p className="editor-error" role="alert" key={p.platform}>Передача: {stateNames[p.state]||p.state}. {p.error}</p>)}
          {indexes.length>limit&&<p className="editor-error">Галерея перевищує ліміт. Виберіть фото самостійно — програма нічого не обрізає.</p>}
          <div className="social-photo-grid">{preview.project.images.map((url,i)=><label key={url} className={indexes.includes(i)?'chosen':''}><img loading="lazy" src={url} alt={'Фото '+(i+1)}/><span><input type="checkbox" aria-label={labels[plan.platform]+': фото '+(i+1)} checked={indexes.includes(i)} onChange={e=>changeSelection(plan.platform,e.target.checked?[...indexes,i]:indexes.filter(n=>n!==i))}/>Фото {i+1}{indexes.includes(i)?' · позиція '+(indexes.indexOf(i)+1):''}</span></label>)}</div>
          <p className="editor-muted">Порядок галереї відповідає порядку вибору. Щоб переставити фото, зніміть вибір і виберіть їх у потрібній послідовності.</p>
          <label className={editor.useCommonCaption?'social-caption-disabled':''}>Опис для {labels[plan.platform]}<textarea aria-label={'Опис '+labels[plan.platform]} rows={6} maxLength={{instagram:2196,facebook:5000,tiktok:4000}[plan.platform]} disabled={editor.useCommonCaption} value={editor.useCommonCaption?editor.commonCaption:captions[plan.platform]??''} onChange={e=>changeCaption(plan.platform,e.target.value)}/></label>
          <p className="editor-muted">{(editor.useCommonCaption?editor.commonCaption:captions[plan.platform]??'').length} символів{editor.useCommonCaption?' · спільний опис':' · окремий опис для '+labels[plan.platform]}</p>
          <label className={editor.useCommonTags?'social-caption-disabled':''}>Теги для {labels[plan.platform]}<textarea aria-label={'Теги '+labels[plan.platform]} rows={2} maxLength={1000} disabled={editor.useCommonTags} value={editor.useCommonTags?editor.commonTags:editor.platformTags[plan.platform]??''} placeholder="#архітектура #дизайн" onChange={e=>changeEditor('platformTags',{...editor.platformTags,[plan.platform]:e.target.value})}/></label>
          {plan.warnings.map((w,i)=><p className="editor-muted" key={i}>{w.includes('Instagram')?'Instagram підрізає фото до пропорції першого. Перевірте композицію галереї.':'TikTok: фотогалерея з ручним завершенням через сповіщення.'}</p>)}
          {!tracked&&
          <button className="editor-primary" disabled={busy||dirty||!row.active||!indexes.length||indexes.length>limit||!dueAt} onClick={()=>run(async()=>{const result=await post('draft',{id:row.id,platform:plan.platform,fingerprint:preview.fingerprint,settingsRevision:preview.settingsRevision,selection,captions,options:editor,dueAt:new Date(dueAt).toISOString()});await load();setMessage(result.existing?'Показано наявну чернетку. Дублікат не створено.':'Створено лише чернетку '+labels[plan.platform]+'. Публікація вимкнена.');})}>Створити чернетку {labels[plan.platform]}</button>}
        </section>;})}</div>
        {preview.plans.length===0&&<p>Усі доступні платформи вимкнено в налаштуваннях.</p>}
      </>}</section></div>
    </>}
    {tab==='drafts'&&<section className="social-panel"><div className="social-heading"><div><h2>Чернетки Buffer</h2><p className="editor-muted">Наявні чернетки збережені в обліку. Оновлення з Buffer показує їхній поточний стан.</p></div><button disabled={busy} onClick={()=>run(()=>readDrafts())}><BufferLabel text="Перечитати з Buffer"/></button></div>
      <div className="social-table-wrap"><table><thead><tr><th>Проєкт</th><th>Платформа</th><th>Дата · {tz}</th><th>Стан</th><th>Дії</th></tr></thead><tbody>
      {(remoteDrafts||data.drafts.map(d=>({...d,id:d.buffer_id,channelService:d.platform,dueAt:d.due_at,status:d.state}))).map(d=>{const link=data.drafts.find(x=>x.buffer_id===d.id),p=sourceRows.find(p=>p.id===(d.project_id||link?.project_id));return <tr key={d.id||d.project_id+d.platform}><td>{p?.project.title||d.text?.split('\n')[0]||'Проєкт'}<small>{d.assets?d.assets.length+' фото':''}</small></td><td>{labels[d.channelService]||d.channelService}</td><td>{formatDate(d.dueAt,tz)}</td><td>{stateNames[d.status]||d.status}{!remoteDrafts&&<small>Облік AutoPoster</small>}</td><td>{d.id&&<button disabled={busy} onClick={()=>run(async()=>setDetail(remoteDrafts?d:await api('social/draft-detail?id='+encodeURIComponent(d.id))))}>Переглянути</button>}</td></tr>;})}
      </tbody></table></div>{(remoteDrafts||data.drafts).length===0&&<p>Чернеток поки немає.</p>}
      {cursor&&<button disabled={busy} onClick={()=>run(()=>readDrafts(cursor))}>Завантажити ще</button>}
      <p className="editor-muted">Редагування вже створених чернеток і їхнє переведення в розклад — у Buffer. Це не відбувається від збереження налаштувань AutoPoster.</p><a className="editor-button" href="https://publish.buffer.com/schedule" target="_blank" rel="noreferrer"><BufferLabel text="Відкрити Buffer ↗"/></a>
    </section>}
    {tab==='settings'&&<form onSubmit={e=>{e.preventDefault();run(async()=>{const result=await post('settings',settings);setSettings(clone(result.settings));setDirty(false);setPreview(null);setSelected('');await load();setMessage(result.message);});}}>
      <h2>Налаштування AutoPoster</h2><p className="editor-muted">Збереження ставить нові надсилання на паузу та скидає готовність проєктів. Існуючі чернетки й дописи Buffer не змінюються.</p>
      <fieldset disabled={busy}>
      <div className="social-settings-grid"><section><h3>Архівні проєкти</h3><label className="social-check"><input type="checkbox" checked={settings.archiveEnabled} onChange={e=>changeSettings('archiveEnabled',e.target.checked)}/>Обробляти архів за графіком</label>
        <p className="editor-muted">{settings.archiveEnabled?'Готовий архів передається у вибрані дні та час.':'Без графіка: після позначки готовності або відновлення передачі черга починає оброблятися одразу. Пауза зупиняє надсилання.'}</p>
        <fieldset className="social-schedule-fields" disabled={!settings.archiveEnabled} aria-label="Параметри графіка архіву"><label>Часова зона<input required list="social-timezones" value={settings.timezone} onChange={e=>changeSettings('timezone',e.target.value)}/></label><datalist id="social-timezones"><option value="Europe/Kyiv"/><option value="Europe/Warsaw"/><option value="Europe/London"/><option value="UTC"/></datalist>
        <div className="social-days" role="group" aria-label="Дні обробки архіву">{[[1,'Пн'],[2,'Вт'],[3,'Ср'],[4,'Чт'],[5,'Пт'],[6,'Сб'],[0,'Нд']].map(([day,text])=><label key={day}><input type="checkbox" checked={settings.archiveDays.includes(day)} onChange={e=>changeSettings('archiveDays',e.target.checked?[...settings.archiveDays,day]:settings.archiveDays.filter(d=>d!==day))}/>{text}</label>)}</div>
        <div className="editor-fields"><label>Година старту<select value={settings.archiveHour} onChange={e=>changeSettings('archiveHour',Number(e.target.value))}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{String(h).padStart(2,'0')}</option>)}</select></label><label>Хвилина<select value={settings.archiveMinute} onChange={e=>changeSettings('archiveMinute',Number(e.target.value))}>{[0,15,30,45].map(m=><option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}</select></label></div>
        <label>Черговість<select value={settings.archiveOrder} onChange={e=>changeSettings('archiveOrder',e.target.value)}><option value="oldest">Спочатку менші номери проєктів</option><option value="newest">Спочатку більші номери проєктів</option></select></label><p className="editor-muted">Один готовий проєкт на кожен вибраний день. Перевірка виконується кожні 15 хвилин; пропущені слоти масово не надолужуються.</p></fieldset></section>
      <section><h3>Нові проєкти та доставка</h3><label className="social-check"><input type="checkbox" checked={settings.newProjectsEnabled} onChange={e=>changeSettings('newProjectsEnabled',e.target.checked)}/>Обробляти нові проєкти після позначки готовності</label>
        <p className="editor-muted">{settings.newProjectsEnabled?'Параметри обробки нових проєктів і доставки.':'Нові проєкти не обробляються. Поля цього блоку неактивні; їхні значення збережено.'}</p>
        <fieldset className="social-schedule-fields" disabled={!settings.newProjectsEnabled} aria-label="Параметри нових проєктів та доставки"><label>Затримка від першого виявлення, годин<input type="number" min="0" max="720" value={settings.newProjectDelayHours} onChange={e=>changeSettings('newProjectDelayHours',Number(e.target.value))}/></label>
        <label>Що створювати після активації<select value={settings.deliveryMode} onChange={e=>changeSettings('deliveryMode',e.target.value)}><option value="draft">Лише чернетки Buffer</option><option value="schedule">Заплановані дописи Buffer</option></select></label>
        <label>Відступ від відправлення до виходу, хвилин<input type="number" min="5" max="1440" value={settings.dispatchDelayMinutes} onChange={e=>changeSettings('dispatchDelayMinutes',Number(e.target.value))}/></label>
        <label>Максимум безпечних повторів<input type="number" min="1" max="5" value={settings.retryLimit} onChange={e=>changeSettings('retryLimit',Number(e.target.value))}/></label>
        <p className="editor-muted">Платформи обробляються поступово. Без графіка починаємо одразу; Cron перевіряє решту черги кожні 15 хвилин. Повтори стосуються підтверджено відхилених запитів; невідомий результат автоматично не повторюється.</p></fieldset></section></div>
      <label className="social-check"><input type="checkbox" checked={settings.allowRepeatDrafts} onChange={e=>changeSettings('allowRepeatDrafts',e.target.checked)}/>Дозволяти повторну передачу проєкту в чернетки Buffer</label><p className="editor-muted">Кожне повторне натискання створює новий комплект чернеток. Попередні чернетки залишаються в Buffer.</p>
      <h3>Платформи</h3><div className="social-settings-platforms">{Object.entries(settings.platforms).map(([p,v])=><section className="social-platform" key={p}><h4><PlatformName platform={p}/></h4><label className="social-check"><input type="checkbox" checked={v.enabled} onChange={e=>changePlatform(p,'enabled',e.target.checked)}/>Використовувати платформу</label>
        <label>Спосіб завершення<select value={v.mode} onChange={e=>changePlatform(p,'mode',e.target.value)}><option value="automatic" disabled={p==='tiktok'&&!data.tiktokAutoVerified}>Автоматично{p==='tiktok'&&!data.tiktokAutoVerified?' — потрібен погоджений тест':''}</option><option value="notification">Сповіщення, завершити вручну</option></select></label>
        <label>Максимум фото в одному дописі<input type="number" min="1" max={p==='instagram'?20:10} value={v.maxPhotos} onChange={e=>changePlatform(p,'maxPhotos',Number(e.target.value))}/></label>
        <p className="editor-muted">Якщо фото більше, допис блокується до ручного відбору. Автоматичного видалення фото немає.</p></section>)}</div>
      <label>Дефолтні теги<textarea aria-label="Дефолтні теги" rows={2} maxLength={1000} value={settings.defaultTags??''} placeholder="#архітектура #дизайн" onChange={e=>changeSettings('defaultTags',e.target.value)}/></label><p className="editor-muted">Підставляються в публікації без власних тегів. Збережені теги проєктів не змінюються.</p>
      <label>Шаблон підпису<textarea rows={7} value={settings.captionTemplate} onChange={e=>changeSettings('captionTemplate',e.target.value)} maxLength={2000}/></label><p className="editor-muted">{'{title} — назва; {number} — номер; {numberSuffix} — тире й номер; {description} — опис із сайту; {url} — посилання. Новий текст не генерується.'}</p>
      </fieldset><div className="social-toolbar"><button className="editor-primary" type="submit" disabled={busy||!dirty}>Зберегти налаштування</button><button type="button" disabled={busy||!dirty} onClick={()=>{setSettings(clone(data.settings));setDirty(false);}}>Скасувати незбережені зміни</button><Download value={data.settings} name="archi-create-social-settings.json">Експорт налаштувань</Download></div>
      <details className="social-activation"><summary>Окрема активація відправлення</summary><p>Зараз Cloudflare працює в режимі <strong>{data.environmentMode}</strong>. Збереження налаштувань не змінює цей захищений режим.</p><p>Після активації всі готові проєкти надсилатимуться в Buffer як <strong>{data.settings.deliveryMode==='draft'?'чернетки':'заплановані дописи'}</strong>. Наявні чернетки не публікуються цією дією.</p><p>Проєктів у черзі: {readyProjects.length}. Платформи: {data.channels.map(c=>labels[c.platform]).join(', ')}.</p><ul>{readyProjects.slice(0,10).map(p=><li key={p.id}>{p.project.title}</li>)}</ul>{data.environmentMode!=='live'?<p className="social-notice">Активація заблокована режимом Cloudflare. Спочатку потрібно окремо погодити дописи та змінити захищений режим Worker. Зараз жодних публікацій не буде.</p>:<><label>Для дозволу введіть: ДОЗВОЛЯЮ ВІДПРАВЛЕННЯ<input value={activation} onChange={e=>setActivation(e.target.value)} autoComplete="off"/></label><button type="button" disabled={busy||dirty||!data.keyConfigured||!readyProjects.length||activation!=='ДОЗВОЛЯЮ ВІДПРАВЛЕННЯ'} onClick={()=>run(async()=>{await post('activate',{confirm:'APPROVE_FIRST_PUBLICATION'});setActivation('');await load();setMessage('Відправлення дозволено згідно зі збереженими налаштуваннями.');})}>Активувати відправлення черги</button></>}</details>
    </form>}
    {tab==='connection'&&<section className="social-panel"><div className="social-heading"><h2>Підключення</h2><button disabled={busy} onClick={()=>run(async()=>{setConnection(null);setConnectionError('');setConnectionCheckedAt(null);try{setConnection(await api('social/channels'));setConnectionCheckedAt(Date.now());setMessage('Перевірено канали Buffer. Дописів не створено.');}catch(e){setConnectionError(e.message||'Не вдалося отримати відповідь Buffer');throw e;}})}>Перевірити з’єднання</button></div>
      <BufferKeyEditor api={api} disabled={busy} onChanged={async () => {
        setConnection(null); setConnectionError(''); setConnectionCheckedAt(null); await load();
      }} />
      {connectionCheckedAt&&<p className="editor-muted">Остання успішна відповідь Buffer: {formatDate(connectionCheckedAt,tz)}</p>}
      <div className="social-settings-platforms">{Object.keys(labels).map(platform=>{
        const channel=data.channels.find(c=>c.platform===platform),enabled=data.settings.platforms[platform].enabled;
        const info=channel?describeConnection(channel,connection,connectionError):{state:'unchecked',account:enabled?'Канал не налаштований':'Платформу вимкнено в налаштуваннях',status:enabled?'Немає відповідного каналу інтеграції':'Передача на цю платформу вимкнена'};
        return <section className="social-platform" key={platform}><h3><PlatformName platform={platform}/></h3><p>{info.account}</p><p className={'social-connection-state '+info.state}>{info.status}</p>{info.detail&&<p>{info.detail}</p>}{info.queue&&<p>{info.queue}</p>}
          <p>{data.settings.deliveryMode==='draft'?'Передача лише в чернетки Buffer':'Передача в розклад Buffer'}</p><p>{(channel?.mode||data.settings.platforms[platform].mode)==='notification'?'Ручне завершення через сповіщення':'Автоматичний спосіб завершення'}</p>{info.mobile&&<p>{info.mobile}</p>}
        </section>;
      })}</div>
      <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">Секрети та режим Worker у Cloudflare ↗</a><p className="editor-muted">Пауза AutoPoster зупиняє лише нові надсилання. Якщо потрібно негайно зупинити вже заплановані дописи — відкрийте Buffer і призупиніть його черги.</p>
    </section>}
    {tab==='events'&&<section className="social-panel"><div className="social-heading"><h2>Історія обробки</h2><Download value={{exportedAt:new Date().toISOString(),settings:data.settings,projects:data.projects,publications:data.publications,drafts:data.drafts,events:data.events}} name="archi-create-social-review.json">Експорт черги й журналу</Download></div>
      {data.publications.length>0&&<><h3>Платформи й публікації</h3><div className="social-table-wrap"><table><thead><tr><th>Проєкт</th><th>Платформа</th><th>Стан</th><th>Оновлено · {tz}</th><th>Спроби</th><th>Повідомлення</th></tr></thead><tbody>{data.publications.map(p=><tr key={p.project_id+p.platform}><td>{sourceRows.find(r=>r.id===p.project_id)?.project.title||p.project_id}</td><td>{labels[p.platform]}</td><td>{stateNames[p.state]||p.state}</td><td className="social-history-date">{p.updated_at?<time dateTime={new Date(p.updated_at).toISOString()}>{formatDate(p.updated_at,tz)}</time>:'—'}</td><td>{p.attempts}</td><td>{p.error||'—'}{p.external_url&&<a href={p.external_url} target="_blank" rel="noreferrer">Переглянути допис ↗</a>}</td></tr>)}</tbody></table></div></>}
      <div className="social-event-list">{data.events.map(e=><article key={e.id}><small>{formatDate(e.created_at,tz)}{e.platform?' · '+labels[e.platform]:''}</small><strong>{eventNames[e.event]||e.event}</strong>{e.project_id&&<p>{sourceRows.find(p=>p.id===e.project_id)?.project.title||e.project_id}</p>}{e.detail&&<details><summary>Деталі</summary><pre className="social-caption">{e.detail}</pre></details>}</article>)}</div>{!data.events.length&&<p>Подій поки немає.</p>}
    </section>}
    {detail&&<div className="social-dialog-backdrop" onClick={e=>{if(e.target===e.currentTarget)setDetail(null);}}><section className="social-dialog" role="dialog" aria-modal="true" aria-label="Перегляд чернетки" onKeyDown={e=>{if(e.key==='Escape')setDetail(null);if(e.key==='Tab'){const controls=e.currentTarget.querySelectorAll('button,a[href],input,select,textarea');const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}><div className="social-heading"><h2>{stateNames[detail.status]||detail.status}</h2><button autoFocus onClick={()=>setDetail(null)}>Закрити</button></div><p>{labels[detail.channelService]||labels[data.channels.find(c=>c.id===detail.channelId)?.platform]||'Buffer'} · {formatDate(detail.dueAt,tz)}</p><pre className="social-caption">{detail.text}</pre><div className="social-photo-grid">{detail.assets?.map((a,i)=><figure key={a.source+i}><img src={a.source} alt={'Фото '+(i+1)}/><figcaption>Фото {i+1}</figcaption></figure>)}</div><p className="editor-muted">{detail.schedulingType==='notification'?'Чернетка передбачає ручне завершення через сповіщення Buffer. Перед публікацією перевірте пропорції та композицію фото. ':''}Це лише перегляд. Закриття вікна не змінює й не публікує допис.</p></section></div>}
  </main>;
}
