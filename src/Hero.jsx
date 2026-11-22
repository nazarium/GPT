import { useEffect, useState } from 'react';
import defaultSlides from '../content/hero.json';
import { defaultHeroCaptionPosition, defaultHeroTiming, heroTransitionMs } from './hero-settings.mjs';

export function Hero({ slides = defaultSlides, timing = defaultHeroTiming, showControls = false }) {
  const [{ index, previous, direction }, setFrame] = useState({ index: 0, previous: null, direction: 0 });
  const [paused, setPaused] = useState(false);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const playing = slides.length > 1 && motionAllowed && !paused;

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: no-preference)');
    const update = () => setMotionAllowed(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setFrame(current => ({
      index: (current.index + 1) % slides.length, previous: current.index, direction: 1,
    })), timing.intervalSeconds * 1000);
    return () => clearTimeout(timer);
  }, [index, playing, slides.length, timing.intervalSeconds]);

  useEffect(() => {
    if (previous === null) return;
    const timer = setTimeout(() => setFrame(current => ({ ...current, previous: null })), heroTransitionMs + 50);
    return () => clearTimeout(timer);
  }, [index, previous]);

  useEffect(() => {
    if (slides.length < 2) return;
    const neighbors = new Set([(index + 1) % slides.length, (index - 1 + slides.length) % slides.length]);
    for (const neighbor of neighbors) {
      const image = new Image();
      image.src = '/' + slides[neighbor].image;
    }
  }, [index, slides]);

  function step(delta) {
    setPaused(true);
    setFrame(current => ({
      index: (current.index + delta + slides.length) % slides.length,
      previous: motionAllowed ? current.index : null,
      direction: delta,
    }));
  }
  const frames = previous === null ? [index] : [previous, index];
  return <section className="hero" aria-labelledby="hero-title">
    <div className={'hero-panorama hero-effect--' + timing.transition} data-direction={direction < 0 ? 'backward' : 'forward'}
      style={{ '--transition-time': heroTransitionMs + 'ms' }}>
      {frames.map(position => {
        const { image, title, accent, captionPosition = defaultHeroCaptionPosition } = slides[position];
        const active = position === index;
        const phase = !active ? ' is-leaving' : previous !== null ? ' is-entering' : direction === 0 ? ' hero-frame--initial' : '';
        const Caption = active ? 'h1' : 'p';
        return <div className={'hero-frame' + phase} key={position} aria-hidden={!active || undefined}
          data-caption-position={captionPosition}>
          <img src={'/' + image} alt="" fetchPriority={direction === 0 ? 'high' : undefined} />
          <Caption className="hero-caption" id={active ? 'hero-title' : undefined} aria-live={active ? (playing ? 'off' : 'polite') : undefined}>
            {title}{accent && <> <em>{accent}</em></>}
          </Caption>
        </div>;
      })}
      {showControls && slides.length > 1 && <div className="hero-slide-controls" role="group" aria-label="Фото шапки">
        <button type="button" aria-label="Попереднє фото шапки" onClick={() => step(-1)}>←</button>
        <span>{index + 1} / {slides.length}</span>
        <button type="button" aria-label="Наступне фото шапки" onClick={() => step(1)}>→</button>
        {motionAllowed && <button type="button" aria-label={paused ? 'Запустити показ слайдів' : 'Призупинити показ слайдів'}
          title={paused ? 'Запустити показ слайдів' : 'Призупинити показ слайдів'}
          onClick={() => setPaused(current => !current)}>{paused ? '▶' : 'Ⅱ'}</button>}
      </div>}
    </div>
  </section>;
}
