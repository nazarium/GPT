import { useEffect, useRef, useState } from 'react';
import { contactSymbols, defaultContactSymbol, studioNumberPatterns, textGroups } from './home-text-fields.mjs';
import { useUnsavedChanges } from './useUnsavedChanges.js';


function SymbolDropdown({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    root.current.querySelector('[aria-selected="true"]')?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function close() { setOpen(false); trigger.current?.focus(); }
  function navigate(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const options = [...root.current.querySelectorAll('[role="option"]')];
    const current = options.indexOf(document.activeElement);
    if (current < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = current + 1;
    if (event.key === 'ArrowLeft') next = current - 1;
    if (event.key === 'ArrowDown') next = current + 4;
    if (event.key === 'ArrowUp') next = current - 4;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next !== undefined) { event.preventDefault(); options[(next + options.length) % options.length]?.focus(); }
  }
  return <div className="home-symbol-dropdown" ref={root} onKeyDown={navigate}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span className="home-symbol-label" id="home-symbol-label">Символ біля заголовка</span>
    <button type="button" ref={trigger} className="home-symbol-trigger" disabled={disabled}
      aria-label="Вибрати символ" aria-haspopup="listbox" aria-expanded={open} aria-controls="home-symbol-options"
      onClick={() => setOpen(current => !current)}>
      <span aria-hidden="true">{value}</span><small>Вибрати символ</small><span aria-hidden="true">⌄</span>
    </button>
    {open && <div id="home-symbol-options" className="home-symbol-popup" role="listbox" aria-labelledby="home-symbol-label">
      {contactSymbols.map((symbol, index) => <button type="button" role="option" key={symbol}
        aria-label={'Символ ' + symbol + ', варіант ' + (index + 1)} aria-selected={value === symbol}
        tabIndex={value === symbol ? 0 : -1} onClick={() => { onChange(symbol); close(); }}>
        <span aria-hidden="true">{symbol}</span>
      </button>)}
    </div>}
  </div>;
}

export function HomeTextsEditor({ api }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useUnsavedChanges(dirty);

  async function run(action) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      setDraft(await action());
      setDirty(false);
      setConflict(false);
    } catch (error) {
      setError(error.message);
      if (error.status === 409) setConflict(true);
    } finally { setBusy(false); }
  }

  const load = () => run(() => api('home/texts'));
  useEffect(() => { load(); }, []);

  function change(key, value) {
    setDraft(current => ({ ...current, texts: { ...current.texts, [key]: value } }));
    setDirty(true);
    setStatus('');
  }

  async function uploadPhoto(event) {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Максимальний розмір фото — 8 МБ.');
      const { image } = await api('home/upload', { method: 'POST', body: file });
      change('studioPhoto', image);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  function publish(event) {
    event.preventDefault();
    run(async () => {
      const saved = await api('home/texts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      });
      setStatus('Зміни головної опубліковано.');
      return saved;
    });
  }

  function field(key, className = '') {
    const [ , label, limit, rows, required = true] = textGroups.flatMap(group => group.fields).find(item => item[0] === key);
    const props = { required, maxLength: limit, value: draft.texts[key] ?? '',
      onChange: event => change(key, event.target.value) };
    return <label className={'home-text-field ' + className} key={key}><span>{label}</span>
      {rows ? <textarea rows={rows} {...props} /> : <input pattern={studioNumberPatterns[key]} {...props} />}
    </label>;
  }

  function sectionLabel(key, number, id, name) {
    return <h3 id={id} className="home-text-eyebrow home-text-section-label"><label>
      <span>{number} /</span><input aria-label={name} required maxLength={80}
        value={draft.texts[key] ?? ''} onChange={event => change(key, event.target.value)} />
    </label></h3>;
  }

  return <form className="home-texts-editor" onSubmit={publish}>
    <h2>Тексти головної</h2>
    {draft && <fieldset disabled={busy}>
      <section className="home-text-section" aria-labelledby="texts-studio-heading">
        {sectionLabel('studioLabel', '02', 'texts-studio-heading', 'Назва розділу «Про студію»')}
        <div className="home-text-columns">
          <div>{field('studioTitle', 'home-text-headline')}{field('studioAccent', 'home-text-headline home-text-accent')}</div>
          <div>{field('studioIntro')}{field('studioDescription')}</div>
        </div>
        <div className="home-text-panorama">
          <img src={'/' + draft.texts.studioPhoto} alt="Попередній перегляд панорами" />
          <label className="home-text-photo-upload" title="Замінити панорамне зображення">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v14H3V7Z" /><circle cx="12" cy="13" r="4" /></svg>
            <input type="file" aria-label="Замінити панорамне зображення" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} />
          </label>
        </div>
        <div className="home-text-facts">{field('studioProjects')}{field('studioYears')}</div>
      </section>
      <section className="home-text-section" aria-labelledby="texts-approach-heading">
        {sectionLabel('approachLabel', '03', 'texts-approach-heading', 'Назва розділу «Підхід»')}
        <div className="home-text-columns home-text-section-heading">
          <div>{field('approachTitle', 'home-text-headline')}{field('approachAccent', 'home-text-headline home-text-accent')}</div>
          <div>{field('approachAside')}</div>
        </div>
        <div className="home-text-steps">{Array.from({ length: 4 }, (_, index) =>
          <div className="home-text-step" key={index}>
            <span className="home-text-step-number">0{index + 1}</span>
            {field('stepTitle' + index)}{field('stepDescription' + index)}
          </div>)}
        </div>
      </section>
      <section className="home-text-section" aria-labelledby="texts-contact-heading">
        {sectionLabel('contactLabel', '05', 'texts-contact-heading', 'Назва розділу «Почнімо з розмови»')}
        <div className="home-text-contact-layout">
          <div>
            {field('contactTitle', 'home-text-headline')}
            {field('contactAccent', 'home-text-headline home-text-accent')}
            {field('contactIntro')}
          </div>
          <div className="home-text-symbol-editor">
            <span className="home-text-symbol-preview" aria-hidden="true">{draft.texts.contactSymbol ?? defaultContactSymbol}</span>
            <SymbolDropdown value={draft.texts.contactSymbol ?? defaultContactSymbol}
              disabled={busy} onChange={symbol => change('contactSymbol', symbol)} />
          </div>
        </div>
      </section>
      <button type="submit" className="editor-primary" disabled={!dirty || conflict}>Зберегти й опублікувати</button>
    </fieldset>}
    {!draft && busy && <p role="status">Завантаження…</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    {(!draft && !busy || conflict) && <button type="button" disabled={busy} onClick={() => {
      if (!dirty || confirm('Замінити незбережені правки актуальними текстами?')) load();
    }}>Завантажити актуальні тексти</button>}
    {status && <p role="status">{status}</p>}
  </form>;
}
