import { useEffect, useState } from 'react';
import { RichTextEditor } from './RichTextEditor.jsx';
import { useUnsavedChanges } from './useUnsavedChanges.js';

export function LegalEditor({ api, id, title }) {
  const [document, setDocument] = useState(null);
  const [bodyHtml, setBodyHtml] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState(false);
  const dirty = !!document && bodyHtml !== document.bodyHtml;
  useUnsavedChanges(dirty);

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

  function apply(saved) {
    setDocument(saved);
    setBodyHtml(saved.bodyHtml);
    setConflict(false);
  }

  function load() {
    return run(async () => apply(await api('legal/' + id)));
  }

  useEffect(() => { load(); }, []);

  function publish(event) {
    event.preventDefault();
    run(async () => {
      apply(await api('legal/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: document.revision, bodyHtml }) }));
      setStatus('Текст опубліковано.');
    });
  }

  return <details className="legal-editor">
    <summary>{title}{dirty && ' · Незбережені зміни'}</summary>
    <form onSubmit={publish}>
      {document && <>
        <RichTextEditor value={bodyHtml} disabled={busy} label={'Текст — ' + title}
          onChange={value => { setBodyHtml(value); setStatus(''); }} />
        <div className="legal-editor-actions">
          <button type="submit" className="editor-primary" disabled={busy || conflict || !dirty}>Зберегти й опублікувати</button>
          <a className="text-link" href={'/' + id + '.html'} target="_blank" rel="noreferrer">Відкрити сторінку ↗</a>
        </div>
      </>}
      {!document && busy && <p role="status">Завантаження…</p>}
      {error && <p className="editor-error" role="alert">{error}</p>}
      {(!document && !busy || conflict) && <button type="button" disabled={busy} onClick={() => {
        if (!dirty || confirm('Замінити незбережений текст актуальною версією?')) load();
      }}>Завантажити актуальну версію</button>}
      {status && <p role="status">{status}</p>}
    </form>
  </details>;
}
