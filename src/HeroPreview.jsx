import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Hero } from './Hero.jsx';

const frameDocument = '<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/hero-motion.css"></head><body></body></html>';

export function HeroPreview({ slides, timing, onClose }) {
  const dialog = useRef(null);
  const [mobile, setMobile] = useState(false);
  const [body, setBody] = useState(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="preview-dialog hero-preview-dialog" aria-label="Попередній перегляд шапки" onClose={onClose}>
    <div className="hero-preview-toolbar">
      <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>Комп’ютер</button>
      <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>Телефон</button>
      <button type="button" className="preview-close" aria-label="Закрити перегляд" title="Закрити перегляд"
        onClick={() => dialog.current.close()}><span aria-hidden="true">×</span></button>
    </div>
    <iframe className={mobile ? 'hero-preview-mobile' : undefined} title="Перегляд шапки" srcDoc={frameDocument}
      onLoad={event => setBody(event.currentTarget.contentDocument.body)} />
    {body && createPortal(<Hero slides={slides} timing={timing} showControls />, body)}
  </dialog>;
}
