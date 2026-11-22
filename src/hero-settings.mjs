export const heroTransitions = {
  fade: 'Перетікання',
  slide: 'Зсув',
  zoom: 'М’який зум',
  wipe: 'Шторка',
  iris: 'Діафрагма',
  focus: 'Перефокусування',
  dark: 'Через затемнення',
  turn: 'Поворот кадру',
};

export const defaultHeroTiming = { transition: 'fade', intervalSeconds: 6.5 };
export const defaultHeroCaptionPosition = 'bottom-left';
export const heroCaptionPositions = {
  'top-left': { arrow: '↖', label: 'Верхній лівий кут' },
  'top-right': { arrow: '↗', label: 'Верхній правий кут' },
  'bottom-left': { arrow: '↙', label: 'Нижній лівий кут' },
  'bottom-right': { arrow: '↘', label: 'Нижній правий кут' },
};
export const minHeroInterval = 2;
export const maxHeroInterval = 60;
export const heroTransitionMs = 800;
export const isHeroInterval = value => Number.isFinite(value) && value >= minHeroInterval
  && value <= maxHeroInterval && Number.isInteger(value * 2);
