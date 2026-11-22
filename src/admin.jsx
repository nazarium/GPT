import { SocialEditor } from './SocialEditor.jsx';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { projectCategories } from './project-categories.mjs';
import { BlogEditor } from './BlogEditor.jsx';
import { HomeEditor } from './HomeEditor.jsx';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { moveItem } from './reorder.mjs';
import { ProjectOrderEditor } from './ProjectOrderEditor.jsx';
import { projectPath } from './project-details.mjs';
import { PublicationStatus, PublishingActions, PreviewDialog, MaterialFilter, matchesFilter, confirmMaterialAction } from './PublishingActions.jsx';

const empty = { title: '', label: '', category: 'residential', url: '', cover: '', images: [], slug: '', description: '' };
const cloud = document.querySelector('meta[name="archi-cloud-admin"]') !== null;
async function api(path, options) {
  const response = await fetch((cloud ? '/api/admin/' : '/__local/') + path, options);
  if (response.ok) return response.json();
  const result = await response.json().catch(() => null);
  throw Object.assign(new Error(result?.error || 'Не вдалося виконати запит (HTTP ' + response.status + ').'), { status: response.status });
}

function Admin() {
  const [projects, setProjects] = useState([]);
  const [draft, setDraft] = useState(empty);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState('');
  const [filter, setFilter] = useState('active');
  const [ordering, setOrdering] = useState(false);
  const coverInput = useRef(null);
  const galleryInput = useRef(null);
  const coverPreview = draft.cover || draft.images[0];
  useUnsavedChanges(dirty || busy);
  useEffect(() => { api('projects').then(items => {
    setProjects(items);
    const id = new URLSearchParams(location.search).get('id');
    const project = items.find(item => item.id === id);
    if (project) open(project);
  }).catch(e => setError(e.message)); }, []);
  function update(values) {
    setDraft(current => ({ ...current, ...values }));
    setDirty(true);
    setStatus('');
  }
  function select(project) {
    if (dirty && !confirm('Відкрити інший проєкт без збереження змін?')) return;
    open(project);
  }
  function open(project) {
    setConflict(false);
    setDraft(project);
    setDirty(false);
    setError('');
    setStatus('');
  }
  async function run(action) {
    setBusy(true);
    setError('');
    setStatus('');
    try { await action(); }
    catch (e) {
      setError(e.message);
      if (e.status === 409) setConflict(true);
    }
    finally { setBusy(false); }
  }
  function upload(event, cover) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    run(async () => {
      if (!cover && draft.images.length + files.length > 40) throw new Error('До 40 фото в галереї.');
      if (files.some(file => file.size > 8 * 1024 * 1024)) throw new Error('Максимальний розмір фото — 8 МБ.');
      for (const file of files) {
        const result = await api('upload', { method: 'POST', body: file });
        if (cover) update({ cover: result.image });
        else {
          setDraft(current => ({ ...current, images: [...current.images, result.image] }));
          setDirty(true);
        }
      }
    });
  }
  function save(event, explicitAction) {
    event.preventDefault();
    const action = cloud ? explicitAction || event.nativeEvent.submitter?.value || 'draft' : 'publish';
    if (action === 'preview' && draft.id && !dirty) {
      setPreview('/admin/preview?kind=projects&id=' + encodeURIComponent(draft.id) + '&revision=' + draft.revision);
      return;
    }
    run(async () => {
      const saved = await api('projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, cover: draft.cover || draft.images[0] || '', action: action === 'preview' ? 'draft' : action }),
      });
      setDraft(saved);
      setDirty(false);
      setProjects(current => draft.id ? current.map(p => p.id === saved.id ? saved : p) : [saved, ...current]);
      setFilter(saved.hidden ? 'hidden' : 'active');
      setStatus(action === 'publish' ? 'Проєкт опубліковано.' : 'Чернетку збережено.');
      if (action === 'preview') setPreview('/admin/preview?kind=projects&id=' + encodeURIComponent(saved.id) + '&revision=' + saved.revision);
    });
  }
  function changeState(action) {
    if (!confirmMaterialAction(action, dirty)) return;
    run(async () => {
      const saved = await api('projects/state', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id, revision: draft.revision, action }) });
      setProjects(current => current.map(item => item.id === saved.id ? saved : item));
      open(saved);
      setFilter(saved.trashed ? 'trash' : saved.hidden ? 'hidden' : 'active');
      setStatus('Стан проєкту оновлено.');
    });
  }
  const results = projects.filter(p => (!cloud || matchesFilter(p, filter))
    && (p.title + ' ' + p.number + ' ' + p.label).toLowerCase().includes(search.toLowerCase().trim()));
  return <>
    {ordering && <ProjectOrderEditor api={api} onClose={() => setOrdering(false)} onSaved={ids => {
      const positions = new Map(ids.map((id, index) => [id, index]));
      setProjects(current => [...current].sort((a, b) => (positions.get(a.id) ?? ids.length) - (positions.get(b.id) ?? ids.length)));
    }} />}
    {preview && <PreviewDialog url={preview} onClose={() => setPreview('')} />}
    <main className="editor">
      <p className="editor-kicker">{cloud ? 'АДМІНПАНЕЛЬ ПОРТФОЛІО' : 'ЛОКАЛЬНА АДМІНПАНЕЛЬ'}</p>
      <h1>Проєкти</h1>
      <div className="editor-layout">
        <aside aria-label="Список проєктів">
          <div className="editor-project-actions"><button className="editor-primary" disabled={busy} onClick={() => select(empty)}>＋ Додати проєкт</button>
          {cloud && <button type="button" disabled={busy} onClick={() => setOrdering(true)}>Порядок портфоліо</button>}</div>
          <label>Пошук<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Назва або номер" /></label>
          {cloud && <MaterialFilter value={filter} onChange={setFilter} items={projects} />}
          <p className="editor-muted">Знайдено {results.length} із {projects.length}</p>
          <div className="editor-list">
            {results.map(project => <button key={project.id} disabled={busy} aria-pressed={draft.id === project.id} onClick={() => select(project)}>
              {project.cover && <img src={'/' + project.cover} alt="" loading="lazy" />}
              <span><strong>{project.title || 'Без назви'}</strong><small>{project.number} · {projectCategories[project.category]}</small>
                {cloud && <small><PublicationStatus item={project} /></small>}</span>
            </button>)}
          </div>
        </aside>
        <form onSubmit={save}>
          <h2>{draft.id ? 'Редагування проєкту' : 'Новий проєкт'}</h2>
          {cloud && <p><PublicationStatus item={draft} />{dirty && ' · Незбережені зміни'}</p>}
          <fieldset disabled={busy || draft.trashed}>
            <h3 className="editor-media-heading">Обкладинка</h3>
            <div className="editor-cover">
              {coverPreview && <img src={'/' + coverPreview} alt="Обкладинка проєкту" />}
              <button type="button" className="editor-upload-icon editor-cover-upload" title="Вибрати обкладинку"
                aria-label="Вибрати обкладинку" onClick={() => coverInput.current.click()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
              </button>
              <input ref={coverInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={e => upload(e, true)} />
            </div>
            {!draft.cover && <p className="editor-muted">Перше фото галереї стане обкладинкою, якщо окрему не вибрано.</p>}
            <div className="editor-gallery-heading">
              <h3>Фото галереї</h3>
              <button type="button" className="editor-upload-icon" title="Додати фото до галереї" aria-label="Додати фото до галереї"
                aria-describedby="editor-gallery-formats" onClick={() => galleryInput.current.click()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              <span className="editor-muted" id="editor-gallery-formats">JPG, PNG або WebP · до 8 МБ на фото</span>
              <input ref={galleryInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={e => upload(e, false)} />
            </div>
            {draft.images.length > 1 && <p className="editor-muted">Перетягніть фото, щоб змінити порядок галереї.</p>}
            <div className="editor-photos">
              {draft.images.map((image, index) => <div key={image + index}
                draggable={!busy && !draft.trashed}
                onDragStart={event => {
                  event.dataTransfer.setData('application/x-archi-photo', String(index));
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={event => { if (event.dataTransfer.types.includes('application/x-archi-photo')) event.preventDefault(); }}
                onDrop={event => {
                  const source = event.dataTransfer.getData('application/x-archi-photo');
                  if (!source || busy || draft.trashed) return;
                  event.preventDefault();
                  const from = Number(source);
                  if (Number.isInteger(from) && from !== index) update({ images: moveItem(draft.images, from, index) });
                }}>
                <span className="photo-position">⠿ Фото {index + 1}</span>
                <img src={'/' + image} alt={'Фото ' + (index + 1)} draggable={false} />
                <div className="photo-actions">
                  <button type="button" className="photo-icon" title="На обкладинку" aria-label="На обкладинку"
                    aria-pressed={draft.cover === image} onClick={() => update({ cover: image })}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg>
                  </button>
                  <button type="button" className="photo-icon" title="Прибрати фото" aria-label="Прибрати фото"
                    onClick={() => update({ images: draft.images.filter((_, i) => i !== index) })}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
                  </button>
                </div>
              </div>)}
            </div>
            <label>Назва<input required maxLength={150} value={draft.title} onChange={e => update({ title: e.target.value })} /></label>
            {cloud && <label>Опис для поширення<textarea rows={3} maxLength={450} value={draft.description || ''}
              onChange={event => update({ description: event.target.value })} /></label>}
            <div className="editor-fields">
              <label>Категорія<select value={draft.category} onChange={e => update({ category: e.target.value })}>
                {Object.entries(projectCategories).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
              </select></label>
              <label>Тип проєкту<input required maxLength={100} placeholder="Житлова архітектура" value={draft.label} onChange={e => update({ label: e.target.value })} /></label>
            </div>
            <label>Посилання на Behance (необов’язково)<input type="url" value={draft.url} placeholder="https://www.behance.net/…" onChange={e => update({ url: e.target.value })} /></label>
            {cloud && <label>Адреса проєкту<input value={draft.slug || ''} maxLength={100}
                pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" placeholder="budynok-u-lvovi" autoCapitalize="none" spellCheck={false}
                onChange={event => update({ slug: event.target.value })}
                onBlur={event => {
                  const slug = event.target.value.trim().toLowerCase();
                  if (slug !== event.target.value) update({ slug });
                }} /></label>}
            {!cloud &&
              <button className="editor-primary" type="submit" disabled={conflict}>{busy ? 'Обробка…' : 'Зберегти проєкт'}</button>}
          </fieldset>
          {cloud && <PublishingActions item={draft} disabled={busy || conflict} label="Дії з проєктом"
            onPublish={event => save(event, 'publish')} onAction={changeState} />}
          {error && <p className="editor-error" role="alert">{error}</p>}
          {conflict && <button type="button" disabled={busy} onClick={() => {
            if (!confirm('Замінити чернетку актуальною версією проєкту?')) return;
            run(async () => {
              const latest = await api('projects');
              const project = latest.find(item => item.id === draft.id);
              if (!project) throw new Error('Проєкт не знайдено.');
              setProjects(latest);
              open(project);
            });
          }}>Завантажити актуальну версію</button>}
          {status && <p role="status">{status} {cloud && draft.published && !draft.hasDraft && !draft.hidden && !draft.trashed &&
            <a href={projectPath(draft)} target="_blank" rel="noreferrer">Відкрити сторінку проєкту ↗</a>}</p>}
        </form>
      </div>
    </main>
  </>;
}

const section = cloud ? new URLSearchParams(location.search).get('section') : null;
const home = section === 'home';
const articles = section === 'articles';
const social = section === 'social';
createRoot(document.getElementById('admin')).render(<>
  <header className="editor-header">
    <a className="editor-brand" href="/"><img src="/assets/logo-original.png" alt="" />ARCHI-CREATE</a>
    {cloud && <nav className="editor-tabs" aria-label="Розділи адмінпанелі">
      <a className="text-link" href="/admin?section=home" aria-current={home ? 'page' : undefined}>Головна</a>
      <a className="text-link" href="/admin?section=projects" aria-current={!home && !articles && !social ? 'page' : undefined}>Проєкти</a>
      <a className="text-link" href="/admin?section=articles" aria-current={articles ? 'page' : undefined}>Статті</a>
      <a className="text-link" href="/admin?section=social" aria-current={social ? 'page' : undefined}>Соцмережі</a>
    </nav>}
    <a className="editor-preview text-link" href={social ? 'https://buffer.com/' : home ? '/' : articles ? '/blog.html' : '/#projects'} target="_blank" rel="noreferrer">
      {social ? 'Відкрити Buffer' : home ? 'Переглянути головну сторінку' : articles ? 'Переглянути блог' : 'Переглянути портфоліо'} <span aria-hidden="true">↗</span>
    </a>
  </header>
  {social ? <SocialEditor api={api} /> : home ? <HomeEditor api={api} /> : articles ? <BlogEditor api={api} /> : <Admin />}
</>);
