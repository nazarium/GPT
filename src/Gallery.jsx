import { useEffect, useRef, useState } from 'react';
import { projectPath } from './project-details.mjs';

export function Gallery({ project, onClose, initialIndex = 0 }) {
  const [index, setIndex] = useState(initialIndex);
  const dialog = useRef(null);
  const thumbs = useRef(null);
  const touch = useRef(null);
  const { images, title } = project;

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    document.body.classList.add('modal-open');
    return () => {
      element.close();
      document.body.classList.remove('modal-open');
    };
  }, []);

  useEffect(() => {
    thumbs.current.children[index]?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index]);

  function step(delta) {
    setIndex(value => Math.max(0, Math.min(images.length - 1, value + delta)));
  }

  function swipeStart(event) {
    const point = event.touches.length === 1 ? event.touches[0] : null;
    touch.current = point ? { x: point.clientX, y: point.clientY } : null;
  }

  function swipeEnd(event) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - start.x;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(point.clientY - start.y)) step(dx < 0 ? 1 : -1);
  }

  return <dialog id="project-dialog" ref={dialog} aria-labelledby="dialog-title" onClose={onClose} onKeyDown={event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowRight' ? 1 : -1);
    }
  }}>
    <div className="gallery-header">
      <div className="gallery-brand"><span>AC /</span> ARCHI-CREATE</div>
      <button type="button" className="dialog-close" aria-label="Закрити проєкт" onClick={() => dialog.current.close()}>×</button>
    </div>
    <div className="gallery-stage" onTouchStart={swipeStart} onTouchEnd={swipeEnd} onTouchCancel={() => { touch.current = null; }}>
      <img id="dialog-image" src={images[index]} alt={title + ' — зображення ' + (index + 1)} draggable={false} />
      <button type="button" id="gallery-prev" className="gallery-arrow" aria-label="Попереднє зображення" disabled={index === 0} onClick={() => step(-1)}>←</button>
      <button type="button" id="gallery-next" className="gallery-arrow" aria-label="Наступне зображення" disabled={index === images.length - 1} onClick={() => step(1)}>→</button>
    </div>
    <div className="gallery-caption">
      <h2 id="dialog-title">{title}</h2>
      <span id="gallery-counter" aria-live="polite">{index + 1} / {images.length}</span>
      {project.slug && !project.hidePageLink && <a className="gallery-page-link" href={projectPath(project)}>Сторінка проєкту ↗</a>}
    </div>
    <div id="gallery-thumbs" className="gallery-thumbs" ref={thumbs} role="group" aria-label="Зображення вибраного проєкту">
      {images.map((source, position) => <button key={source} type="button" className="gallery-thumb"
        aria-label={'Показати зображення ' + (position + 1)} aria-pressed={position === index} onClick={() => setIndex(position)}>
        <img src={source} alt="" loading="lazy" />
      </button>)}
    </div>
  </dialog>;
}
