import { useEffect, useRef, useState } from 'react';
import { moveItem } from './reorder.mjs';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { PublicationStatus } from './PublishingActions.jsx';

export function ProjectOrderEditor({ api, onClose, onSaved }) {
  const dialog = useRef(null);
  const [items, setItems] = useState([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState(false);
  useUnsavedChanges(dirty || busy);

  async function load() {
    setBusy(true);
    setError('');
    try {
      const result = await api('projects/order');
      setItems(result.items);
      setRevision(result.revision);
      setDirty(false);
      setConflict(false);
      setStatus('');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    dialog.current.showModal();
    load();
  }, []);

  function move(from, to) {
    if (busy || conflict) return;
    const next = moveItem(items, from, to);
    if (next === items) return;
    setItems(next);
    setDirty(true);
    setStatus('');
  }
  function close() {
    if (busy || (dirty && !confirm('Закрити без збереження порядку проєктів?'))) return;
    onClose();
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await api('projects/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision, ids: items.map(item => item.id) }),
      });
      setItems(result.items);
      setRevision(result.revision);
      setDirty(false);
      setStatus('Порядок портфоліо збережено на сайті.');
      onSaved(result.items.map(item => item.id));
    } catch (error) {
      setError(error.message);
      if (error.status === 409) setConflict(true);
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="order-dialog" aria-labelledby="order-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="order-heading"><h2 id="order-title">Порядок портфоліо</h2>
      <button type="button" disabled={busy} onClick={close}>Закрити</button></div>
    <p>Перетягуйте картки або користуйтеся стрілками. Перші картки будуть першими в портфоліо та у своїх категоріях. Чернетки й приховані роботи з’являться на цих місцях після публікації або показу.</p>
    <div className="order-grid">
      {items.map((item, index) => <article key={item.id} className="order-card" data-order-id={item.id}
        draggable={!busy && !conflict}
        onDragStart={event => {
          event.dataTransfer.setData('application/x-archi-project', item.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={event => { if (event.dataTransfer.types.includes('application/x-archi-project')) event.preventDefault(); }}
        onDrop={event => {
          const id = event.dataTransfer.getData('application/x-archi-project');
          if (!id) return;
          event.preventDefault();
          move(items.findIndex(item => item.id === id), index);
        }}>
        {item.cover && <img src={'/' + item.cover} alt="" draggable={false} />}
        <strong>{index + 1}. {item.title || 'Без назви'}</strong>
        <small><PublicationStatus item={item} /></small>
        <div className="reorder-buttons">
          <button type="button" disabled={busy || conflict || index === 0} aria-label="Перемістити проєкт раніше" onClick={() => move(index, index - 1)}>↑</button>
          <button type="button" disabled={busy || conflict || index === items.length - 1} aria-label="Перемістити проєкт пізніше" onClick={() => move(index, index + 1)}>↓</button>
        </div>
      </article>)}
    </div>
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    <div className="order-footer">
      <button type="button" className="editor-primary" disabled={busy || !dirty || conflict} onClick={save}>Зберегти порядок на сайті</button>
      <button type="button" disabled={busy} onClick={() => {
        if (!dirty || confirm('Замінити незбережену перестановку актуальним порядком?')) load();
      }}>Завантажити актуальний порядок</button>
    </div>
  </dialog>;
}
