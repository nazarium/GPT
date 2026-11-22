import { useEffect, useState } from 'react';
import { articlePath } from './article-address.mjs';
import { findArticleCrosslinks } from './article-crosslinks.mjs';

export function ArticleCrosslinks({ api, article, catalogRevision, disabled, onInsert }) {
  const [targets, setTargets] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api('articles/links').then(items => { if (!cancelled) { setTargets(items); setError(''); } })
      .catch(error => { if (!cancelled) setError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, catalogRevision]);
  useEffect(() => {
    setSuggestions([]);
    const timer = setTimeout(() => setSuggestions(findArticleCrosslinks(article.bodyHtml, article.id, targets,
      { title: article.title, excerpt: article.excerpt })), 400);
    return () => clearTimeout(timer);
  }, [article.bodyHtml, article.id, article.title, article.excerpt, targets]);
  useEffect(() => { setMessage(''); }, [article.id]);
  return <section className="article-crosslinks" aria-label="Перехресні посилання">
    <h3>Перехресні посилання</h3>
    <p className="editor-muted">До 3 найкращих пропозицій за контекстом назви, анонсу й тексту статті.</p>
    {loading && <p role="status">Шукаємо пов’язані статті…</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    {!loading && !error && !suggestions.length && <p className="editor-muted">Нових збігів немає. Додайте текст або перефразуйте згадки інших тем.</p>}
    {suggestions.map(target => <div className="crosslink-suggestion" key={target.id}>
      <strong>{target.title}</strong>
      <small>{articlePath(target)}</small>
      {target.anchor && <p>Фраза в тексті · «{target.anchor}»</p>}
      <div><button type="button" disabled={disabled} onClick={() => {
        setMessage(onInsert(target) ? 'Посилання додано наприкінці тексту. Збережіть зміни статті.' : 'Це посилання вже є в тексті.');
      }}>Додати «Читайте також»</button>
      <a href={articlePath(target)} target="_blank" rel="noreferrer">Переглянути ↗</a></div>
    </div>)}
    {message && <p role="status">{message}</p>}
  </section>;
}
