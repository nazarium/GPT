import { contrastRatio, defaultPalette } from '../src/site-palette.mjs';
import { defaultFonts, siteFonts } from '../src/site-fonts.mjs';

export function typographyCss({ heading, body }) {
  if (heading === defaultFonts.heading && body === defaultFonts.body) return '';
  return `
  body { font-family: ${siteFonts[body].stack}; }
  h1, h2, h3, h4, h5, h6, .project-title { font-family: ${siteFonts[heading].stack}; }
  `;
}

export function paletteCss({ paper, ink, muted, accent, surface }) {
  if (Object.entries({ paper, ink, muted, accent, surface }).every(([key, value]) => value === defaultPalette[key])) {
    return '/* Original site palette */';
  }
  const scheme = contrastRatio(paper, '#000000') > contrastRatio(paper, '#ffffff') ? 'light' : 'dark';
  const accentInk = contrastRatio(accent, '#000000') > contrastRatio(accent, '#ffffff') ? '#000' : '#fff';
  return `:root {
    color-scheme: ${scheme};
    --paper: ${paper}; --ink: ${ink}; --muted: ${muted}; --accent: ${accent};
    --line: color-mix(in srgb, var(--paper), var(--ink) 17%);
    --button-fill: ${surface};
    --button-border: color-mix(in srgb, var(--button-fill), var(--ink) 30%);
    --button-hover: color-mix(in srgb, var(--button-fill), var(--ink) 10%);
  }
  .article-body, .contact-form :is(input, textarea) { color: var(--ink); }
  .contact-form :is(input, textarea) { background: var(--button-fill); border-color: var(--button-border); }
  .contact-form :is(input, textarea)::placeholder { color: var(--muted); }
  :is(.hero-bottom .text-link, .contact-submit, .nav-contact, .filters button.active):hover {
    background: color-mix(in srgb, var(--ink), var(--paper) 12%);
    border-color: var(--ink);
  }
  ::selection, :is(.hero-bottom .text-link, .contact-submit, .nav-contact)>span { background: var(--accent); color: ${accentInk}; }
  #project-dialog, #project-dialog::backdrop, #project-dialog .gallery-stage { background: var(--paper); }
  #project-dialog :is(.dialog-close, .gallery-arrow, .gallery-thumb) { background: var(--button-fill); color: var(--ink); }
  #project-dialog :is(.dialog-close, .gallery-arrow):hover { background: var(--button-hover); }
  #project-dialog .gallery-thumbs { scrollbar-color: var(--button-border) var(--paper); }
  `;
}
