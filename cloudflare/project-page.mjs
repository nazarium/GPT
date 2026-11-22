import { createElement } from 'react';
import { renderToString } from 'react-dom/server.browser';
import { App } from '../.build/app.mjs';
import { escapeHtml } from '../src/article-text.mjs';
import { projectDetails, projectPath } from '../src/project-details.mjs';

export async function renderProject(request, env, item, preview = false) {
  const project = projectDetails(item);
  const template = await (await env.ASSETS.fetch(new URL('/index.html', request.url))).text();
  const bundle = template.match(/<script type="module" src="([^"]+)"/)?.[1];
  if (!bundle) return new Response('Сторінка тимчасово недоступна.', { status: 503 });
  const canonical = 'https://archi-create.com.ua' + projectPath(project);
  const description = project.description || project.label;
  const imageUrl = image => /^https?:\/\//i.test(image || '') ? image : 'https://archi-create.com.ua/' + (image || 'assets/logo-original.png');
  const shareImage = imageUrl(project.cover || project.images[0]);
  const page = { kind: 'project', preview, hasDraft: item.hasDraft, hidden: item.hidden, trashed: item.trashed,
    buildYear: new Date().getFullYear(), project: {
      ...project, title: project.title || 'Без назви',
      cover: project.cover ? (/^https?:\/\//i.test(project.cover) ? project.cover : '/' + project.cover) : '',
      images: project.images.map(image => /^https?:\/\//i.test(image) ? image : '/' + image),
    } };
  const data = JSON.stringify(page).replaceAll('<', '\\u003c');
  const script = new URL(bundle, new URL('/', request.url)).pathname;
  const html = `<!doctype html><html lang="uk"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(project.title || 'Без назви')} — Archi-Create</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(project.title)}">
    <meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${escapeHtml(shareImage)}">
    <meta name="twitter:card" content="summary_large_image">
    ${preview ? '<meta name="robots" content="noindex,nofollow">' : ''}
    <link rel="icon" href="/assets/favicon.png">
    <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/blog-contact.css">
    <link rel="stylesheet" href="/buttons.css"><link rel="stylesheet" href="/gallery.css">
    <link rel="stylesheet" href="/site-palette.css">
    </head><body><div id="app">${renderToString(createElement(App, { page }))}</div>
    <script id="page-data" type="application/json">${data}</script>
    <script type="module" src="${script}"></script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    ...(preview ? { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' } : {}) } });
}
