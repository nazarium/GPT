import { useEffect, useState } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { LegalEditor } from './LegalEditor.jsx';
import { HeroPreview } from './HeroPreview.jsx';
import { HomeOrderEditor } from './HomeOrderEditor.jsx';
import { HomeSocialEditor } from './HomeSocialEditor.jsx';
import { HomeTextsEditor } from './HomeTextsEditor.jsx';
import { HomeContactsEditor } from './HomeContactsEditor.jsx';
import { HomePaletteEditor } from './HomePaletteEditor.jsx';
import { HomeTypographyEditor } from './HomeTypographyEditor.jsx';
import { moveItem } from './reorder.mjs';
import { defaultHeroCaptionPosition, heroCaptionPositions, heroTransitions, minHeroInterval, maxHeroInterval, isHeroInterval } from './hero-settings.mjs';

const homeTabs=[['carousel','Карусель'],['order','Портфоліо й статті'],['texts','Тексти'],['contacts','Контакти'],['appearance','Оформлення'],['legal','Правові сторінки'],['sharing','Прев’ю посилання']];

function HomeTabIcon({name}) {
  const paths={carousel:'M3 4h18v16H3V4Zm0 11 5-5 5 5 3-3 5 5M7 7h.01',order:'M9 5h12M9 12h12M9 19h12M3 4h2v3M3 11h2v3M3 18h2v3',texts:'M4 4h16M12 4v16M8 20h8',contacts:'M4 3h16v18H4V3Zm4 4h8M8 11h8M8 15h5',appearance:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8h2a4 4 0 0 0 4-4C21 6 17 3 12 3ZM7 9h.01M10 6h.01M15 7h.01M6 13h.01',legal:'M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h7',sharing:'M8 12 16 7M8 12l8 5M7 12a2 2 0 1 0-4 0 2 2 0 1 0 4 0Zm13-6a2 2 0 1 0-4 0 2 2 0 1 0 4 0Zm0 12a2 2 0 1 0-4 0 2 2 0 1 0 4 0Z'};
  return <svg className="editor-tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>;
}

const slideDragType = 'application/x-archi-hero-slide';

export function HomeEditor({ api }) {
  const [activeTab,setActiveTab]=useState('carousel');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState(false);
  useUnsavedChanges(dirty || busy);

  async function run(action) {
    setBusy(true);
    setError('');
    setStatus('');
    try { await action(); }
    catch (error) {
      setError(error.message);
      if (error.status === 409) setConflict(true);
    } finally { setBusy(false); }
  }

  function load() {
    return run(async () => {
      setDraft(await api('home'));
      setDirty(false);
      setConflict(false);
    });
  }

  useEffect(() => { load(); }, []);

  function editSlides(update) {
    setDraft(current => ({ ...current, slides: update(current.slides) }));
    setDirty(true);
    setStatus('');
  }

  function editSlide(index, values) {
    editSlides(slides => slides.map((slide, position) => position === index ? { ...slide, ...values } : slide));
  }

  function upload(event, index) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    run(async () => {
      if (index === undefined && draft.slides.length + files.length > 8) throw new Error('У шапці може бути до 8 фото.');
      if (files.some(file => file.size > 8 * 1024 * 1024)) throw new Error('Максимальний розмір фото — 8 МБ.');
      for (const file of files) {
        const { image } = await api('home/upload', { method: 'POST', body: file });
        if (index === undefined) editSlides(slides => [...slides, { ...slides[0], image, captionPosition: defaultHeroCaptionPosition }]);
        else editSlide(index, { image });
      }
    });
  }

  function reorder(from, to) {
    if (busy || from === to) return;
    editSlides(slides => moveItem(slides, from, to));
  }

  function publish(event) {
    event.preventDefault();
    run(async () => {
      const saved = await api('home', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, intervalSeconds: Number(draft.intervalSeconds) }),
      });
      setDraft(saved);
      setDirty(false);
      setStatus('Шапку головної сторінки опубліковано.');
    });
  }

  function editTiming(key, value) {
    setDraft(current => ({ ...current, [key]: value }));
    setDirty(true);
    setStatus('');
  }

  return <main className="editor">
    <h1>Головна</h1>
    <nav className="editor-accent-tabs" role="tablist" aria-label="Налаштування головної сторінки" onKeyDown={event=>{
      const index=homeTabs.findIndex(([id])=>id===activeTab);
      const next=event.key==='ArrowRight'?(index+1)%homeTabs.length:event.key==='ArrowLeft'?(index+homeTabs.length-1)%homeTabs.length:event.key==='Home'?0:event.key==='End'?homeTabs.length-1:null;
      if(next===null)return;event.preventDefault();const id=homeTabs[next][0];setActiveTab(id);document.getElementById('home-tab-'+id)?.focus();
    }}>{homeTabs.map(([id,label])=><button key={id} type="button" role="tab" id={'home-tab-'+id} aria-controls={'home-panel-'+id} aria-selected={activeTab===id} tabIndex={activeTab===id?0:-1} onClick={()=>setActiveTab(id)}><HomeTabIcon name={id}/><span>{label}</span></button>)}</nav>
    <section className="home-editor-panel" role="tabpanel" id="home-panel-carousel" aria-labelledby="home-tab-carousel" hidden={activeTab!=='carousel'}>
    <form className="home-editor" onSubmit={publish}>
      <h2>Карусель</h2>
      {!draft && busy && <p role="status">Завантаження…</p>}
      {draft && <fieldset disabled={busy}>
        <div className="editor-fields">
          <label>Ефект переходу<select value={draft.transition} onChange={event => editTiming('transition', event.target.value)}>
            {Object.entries(heroTransitions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Час показу фото, сек<input type="number" required min={minHeroInterval} max={maxHeroInterval} step="0.5"
            value={draft.intervalSeconds} onChange={event => editTiming('intervalSeconds', event.target.value)} /></label>
        </div>
        <p className="editor-muted">Перетягніть фото, щоб змінити порядок показу. Перше у списку відкривається першим.</p>
        {draft.slides.map((slide, index) => <section className="home-editor-slide" key={index} aria-label={'Фото ' + (index + 1)}
          onDragOver={event => {
            if (!busy && event.dataTransfer.types.includes(slideDragType)) event.preventDefault();
          }}
          onDrop={event => {
            const source = event.dataTransfer.getData(slideDragType);
            if (!source || !/^\d+$/.test(source)) return;
            event.preventDefault();
            reorder(Number(source), index);
          }}>
          <div>
            <div className="home-slide-preview" data-caption-position={slide.captionPosition ?? defaultHeroCaptionPosition}
              draggable={!busy && draft.slides.length > 1} onDragStart={event => {
                event.dataTransfer.setData(slideDragType, String(index));
                event.dataTransfer.effectAllowed = 'move';
              }}>
              <img src={'/' + slide.image} alt="" draggable={false} />
              <p>{slide.title}{slide.accent && <> <em>{slide.accent}</em></>}</p>
            </div>
            <div className="home-slide-actions">
              {draft.slides.length > 1 && <div className="reorder-buttons">
                <button type="button" disabled={index === 0} aria-label="Перемістити фото раніше" onClick={() => reorder(index, index - 1)}>↑</button>
                <button type="button" disabled={index === draft.slides.length - 1} aria-label="Перемістити фото пізніше" onClick={() => reorder(index, index + 1)}>↓</button>
              </div>}
              <label className="home-slide-replace">Замінити фото
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => upload(event, index)} />
              </label>
              {draft.slides.length > 1 && <button type="button" className="home-slide-remove" title="Прибрати фото" aria-label="Прибрати фото"
                onClick={() => editSlides(slides => slides.filter((_, position) => position !== index))}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
              </button>}
            </div>
          </div>
          <div>
            <h3>Фото {index + 1}</h3>
            <label>Заголовок<textarea value={slide.title} rows={2} maxLength={100} required
              onChange={event => editSlide(index, { title: event.target.value })} /></label>
            <label>Текст акцентним кольором<input value={slide.accent} maxLength={40}
              onChange={event => editSlide(index, { accent: event.target.value })} /></label>
            <div className="home-caption-position" role="group" aria-label={'Позиція тексту, фото ' + (index + 1)}>
              <span>Позиція тексту</span>
              <div className="home-caption-buttons">
                {Object.entries(heroCaptionPositions).map(([value, { arrow, label }]) =>
                  <button key={value} type="button" title={label} aria-label={label}
                    aria-pressed={(slide.captionPosition ?? defaultHeroCaptionPosition) === value}
                    onClick={() => editSlide(index, { captionPosition: value })}>{arrow}</button>)}
              </div>
            </div>
          </div>
        </section>)}
        {draft.slides.length < 8 && <label>Додати фото<input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => upload(event)} /></label>}
        <p className="editor-muted">До 8 фото. JPG, PNG або WebP, до 8 МБ кожне.</p>
        <button type="submit" className="editor-primary" disabled={!dirty || conflict}>Зберегти й опублікувати</button>
        <button type="button" className="home-preview-button" disabled={!isHeroInterval(Number(draft.intervalSeconds))}
          onClick={() => setPreview(true)}>Попередній перегляд</button>
      </fieldset>}
      {error && <p className="editor-error" role="alert">{error}</p>}
      {(!draft && !busy || conflict) && <button type="button" disabled={busy} onClick={() => {
        if (!dirty || confirm('Відкрити актуальну версію без незбережених правок?')) load();
      }}>Завантажити актуальну версію</button>}
      {status && <p role="status">{status}</p>}
    </form>
    </section>
    {preview && <HeroPreview slides={draft.slides}
      timing={{ transition: draft.transition, intervalSeconds: Number(draft.intervalSeconds) }} onClose={() => setPreview(false)} />}
    <section className="home-editor-panel" role="tabpanel" id="home-panel-order" aria-labelledby="home-tab-order" hidden={activeTab!=='order'}><HomeOrderEditor api={api} /></section>
    <section className="home-editor-panel" role="tabpanel" id="home-panel-texts" aria-labelledby="home-tab-texts" hidden={activeTab!=='texts'}><HomeTextsEditor api={api} /></section>
    <section className="home-editor-panel" role="tabpanel" id="home-panel-contacts" aria-labelledby="home-tab-contacts" hidden={activeTab!=='contacts'}><HomeContactsEditor api={api} /></section>
    <section className="home-editor-panel" role="tabpanel" id="home-panel-appearance" aria-labelledby="home-tab-appearance" hidden={activeTab!=='appearance'}><section className="home-appearance" aria-label="Кольори та шрифти"><HomePaletteEditor api={api} /><HomeTypographyEditor api={api} /></section></section>
    <section className="home-editor-panel" role="tabpanel" id="home-panel-legal" aria-labelledby="home-tab-legal" hidden={activeTab!=='legal'}>
      <section className="home-legal" aria-labelledby="home-legal-title">
        <h2 id="home-legal-title">Правові сторінки</h2>
        <LegalEditor api={api} id="terms" title="Умови використання" />
        <LegalEditor api={api} id="privacy-policy" title="Політика конфіденційності" />
      </section>
    </section>
    <section className="home-editor-panel" role="tabpanel" id="home-panel-sharing" aria-labelledby="home-tab-sharing" hidden={activeTab!=='sharing'}><HomeSocialEditor api={api} /></section>
  </main>;
}
