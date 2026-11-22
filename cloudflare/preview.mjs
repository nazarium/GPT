import { createElement } from 'react';
import { renderToString } from 'react-dom/server.browser';
import { App } from '../.build/app.mjs';
import { articleBody } from './blog.mjs';
import { renderProject } from './project-page.mjs';

export async function renderPreview(request, env, kind, item) {
  if (kind === 'projects') return renderProject(request, env, item, true);
  item = { ...item, title: item.title || 'Без назви' };
  const template = await (await env.ASSETS.fetch(new URL('/index.html', request.url))).text();
  const bundle = template.match(/<script type="module" src="([^"]+)"/)?.[1];
  if (!bundle) return new Response('Перегляд тимчасово недоступний.', { status: 503 });
  const page = {
    preview: true, hasDraft: item.hasDraft, hidden: item.hidden, trashed: item.trashed, buildYear: new Date().getFullYear(),
    kind: 'article', body: articleBody(item),
  };
  const data = JSON.stringify(page).replaceAll('<', '\\u003c');
  const script = new URL(bundle, new URL('/', request.url)).pathname;
  return new Response(`<!doctype html><html lang="uk"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><base href="/blog/">
    <title>Попередній перегляд — Archi-Create</title>
    <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/blog-contact.css">
    <link rel="stylesheet" href="/buttons.css"><link rel="stylesheet" href="/gallery.css">
    <link rel="stylesheet" href="/site-palette.css">
    </head><body><div id="app">${renderToString(createElement(App, { page }))}</div>
    <script id="page-data" type="application/json">${data}</script>
    <script type="module" src="${script}"></script></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' },
  });
}
