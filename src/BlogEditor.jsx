import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { RichTextEditor } from './RichTextEditor.jsx';
import { textToHtml } from './article-text.mjs';
import { articlePath, articleSlug } from './article-address.mjs';
import { ArticleCrosslinks } from './ArticleCrosslinks.jsx';
import { PublicationStatus, PublishingActions, PreviewDialog, MaterialFilter, matchesFilter, confirmMaterialAction } from './PublishingActions.jsx';

const blank = () => ({ title: '', slug: 'post01', slugAutomatic: true, excerpt: '', date: new Date().toISOString().slice(0, 10), cover: '', bodyHtml: '' });

export function BlogEditor({ api }) {
  const coverInput = useRef(null);
  const textEditor = useRef(null);
  const [articles, setArticles] = useState([]);
  const [draft, setDraft] = useState(blank);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState('');
  const [filter, setFilter] = useState('active');
  useUnsavedChanges(dirty || busy);

  useEffect(() => { api('articles').then(items => {
    setArticles(items);
    const id = new URLSearchParams(location.search).get('id');
    const article = items.find(item => item.id === id);
    if (article) open(article);
  }).catch(e => setError(e.message)); }, [api]);
  function open(article) {
    const bodyHtml = article.bodyHtml ?? (article.text === undefined ? article.legacyBody ?? '' : textToHtml(article.text));
    setDraft({ ...article, bodyHtml, slug: article.slug || articleSlug(article.title),
      slugAutomatic: article.slugAutomatic ?? !article.slug });
    setConflict(false);
    setDirty(false);
    setError('');
    setStatus('');
  }
  function select(article) {
    if (!dirty || confirm('Відкрити іншу статтю без збереження змін?')) open(article);
  }
  function update(change) {
    setDraft(current => ({ ...current, ...change }));
    setDirty(true);
    setStatus('');
  }
  async function run(action) {
    setBusy(true);
    setError('');
    setStatus('');
    try { await action(); }
    catch (error) { setError(error.message); if (error.status === 409) setConflict(true); }
    finally { setBusy(false); }
  }
  function save(event, explicitAction) {
    event.preventDefault();
    const action = explicitAction || event.nativeEvent.submitter?.value || 'draft';
    if (action === 'preview' && draft.id && !dirty) {
      setPreview('/admin/preview?kind=articles&id=' + encodeURIComponent(draft.id) + '&revision=' + draft.revision);
      return;
    }
    run(async () => {
      const { id, revision, title, excerpt, date, cover, bodyHtml, slug, slugAutomatic } = draft;
      const article = await api('articles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, revision, title, excerpt, date, cover, bodyHtml, slug, slugAutomatic, action: action === 'preview' ? 'draft' : action }),
      });
      setArticles(current => [...current.filter(item => item.id !== article.id), article].sort((a, b) => b.date.localeCompare(a.date)));
      open(article);
      setFilter(article.hidden ? 'hidden' : 'active');
      setStatus(action === 'publish' ? 'Статтю опубліковано.' : 'Чернетку збережено.');
      if (action === 'preview') setPreview('/admin/preview?kind=articles&id=' + encodeURIComponent(article.id) + '&revision=' + article.revision);
    });
  }
  function upload(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    run(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error('Максимальний розмір фото — 8 МБ.');
      const result = await api('upload', { method: 'POST', body: file });
      update({ cover: result.image });
    });
  }
  function changeState(action) {
    if (!confirmMaterialAction(action, dirty)) return;
    run(async () => {
      const saved = await api('articles/state', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id, revision: draft.revision, action }) });
      setArticles(current => current.map(item => item.id === saved.id ? saved : item));
      open(saved);
      setFilter(saved.trashed ? 'trash' : saved.hidden ? 'hidden' : 'active');
      setStatus('Стан статті оновлено.');
    });
  }
  const visible = articles.filter(article => matchesFilter(article, filter) && article.title.toLowerCase().includes(search.toLowerCase().trim()));
  return <>
    {preview && <PreviewDialog url={preview} onClose={() => setPreview('')} />}
    <main className="editor">
      <p className="editor-kicker">АДМІНПАНЕЛЬ БЛОГУ</p>
      <h1>Статті</h1>
      <div className="editor-layout">
        <aside aria-label="Список статей">
          <button className="editor-primary" disabled={busy} onClick={() => select(blank())}>＋ Додати статтю</button>
          <label>Пошук<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Назва статті" /></label>
          <MaterialFilter value={filter} onChange={setFilter} items={articles} />
          <p className="editor-muted">Знайдено {visible.length} із {articles.length}</p>
          <div className="editor-list">{visible.map(article => <button key={article.id} disabled={busy} aria-pressed={draft.id === article.id} onClick={() => select(article)}>
            {article.cover && <img src={'/' + article.cover} alt="" loading="lazy" />}
            <span><strong>{article.title || 'Без назви'}</strong><small>{article.date} · <PublicationStatus item={article} /></small></span>
          </button>)}</div>
        </aside>
        <form onSubmit={save}>
          <h2>{draft.id ? 'Редагування статті' : 'Нова стаття'}</h2>
          <p><PublicationStatus item={draft} />{dirty && ' · Незбережені зміни'}</p>
          <fieldset disabled={busy || draft.trashed}>
            <label>Назва<input required maxLength={180} value={draft.title} onChange={e => {
              const title = e.target.value;
              update({ title, ...(!title.trim() ? { slug: 'post01', slugAutomatic: true }
                : draft.slugAutomatic ? { slug: articleSlug(title) } : {}) });
            }} /></label>
            <label>Адреса<input value={draft.slug || ''} maxLength={100} pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*"
              placeholder="yak-obraty-arkhitektora" autoCapitalize="none" spellCheck={false}
              onChange={event => update({ slug: event.target.value, slugAutomatic: false })}
              onBlur={event => { const slug = event.target.value.trim().toLowerCase(); if (slug !== event.target.value) update({ slug }); }} /></label>
            <p className="editor-muted">{draft.slug ? '/blog/' + draft.slug + '/' : draft.id ? articlePath(draft) : 'Задайте адресу латиницею. При зміні опублікованої адреси буде створено перенаправлення 301.'}</p>
            {!draft.slugAutomatic && <button type="button" onClick={() => update({ slug: articleSlug(draft.title), slugAutomatic: true })}>Сформувати адресу з назви</button>}
            <label>Дата<input required type="date" value={draft.date} onChange={e => update({ date: e.target.value })} /></label>
            <label>Анонс<textarea rows={3} maxLength={450} value={draft.excerpt} onChange={e => update({ excerpt: e.target.value })} /></label>
            <RichTextEditor allowVideo iconToolbar editorApiRef={textEditor} value={draft.bodyHtml} disabled={busy || draft.trashed} onChange={bodyHtml => update({ bodyHtml })} />
            <ArticleCrosslinks api={api} article={draft} catalogRevision={articles} disabled={busy || draft.trashed}
              onInsert={target => textEditor.current?.insertArticleLink(target) || false} />
            <h3 className="editor-media-heading">Обкладинка</h3>
            <div className="editor-cover">
              {draft.cover && <img src={'/' + draft.cover} alt="Обкладинка статті" />}
              <div className="article-cover-actions">
                <button type="button" className="editor-upload-icon" title="Вибрати обкладинку" aria-label="Вибрати обкладинку"
                  onClick={() => coverInput.current.click()}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
                </button>
                {draft.cover && <button type="button" className="editor-upload-icon" title="Прибрати обкладинку" aria-label="Прибрати обкладинку"
                  onClick={() => update({ cover: '' })}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>
                </button>}
              </div>
              <input ref={coverInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={upload} />
            </div>
          </fieldset>
          <PublishingActions item={draft} disabled={busy || conflict} label="Дії зі статтею"
            onPublish={event => save(event, 'publish')} onAction={changeState} />
          {error && <p className="editor-error" role="alert">{error}</p>}
          {conflict && <button type="button" disabled={busy} onClick={() => run(async () => {
            if (!confirm('Замінити незбережену чернетку актуальною версією?')) return;
            const latest = await api('articles');
            const article = latest.find(item => item.id === draft.id);
            if (!article) throw new Error('Статтю не знайдено.');
            setArticles(latest);
            open(article);
          })}>Завантажити актуальну версію</button>}
          {status && <p role="status">{status} {draft.published && !draft.hasDraft && !draft.hidden && !draft.trashed && <a href={articlePath(draft)} target="_blank" rel="noreferrer">Опублікована стаття ↗</a>}</p>}
        </form>
      </div>
    </main>
  </>;
}
