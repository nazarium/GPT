import { compileBlogTemplate } from '../src/blog-template.mjs';
import { writeBackupBuild } from './backup-build.mjs';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

await mkdir('.build', { recursive: true });
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await cp('public', 'dist', { recursive: true });
const options = { bundle: true, jsx: 'automatic', logLevel: 'warning' };
await build({ ...options, entryPoints: ['src/App.jsx'], platform: 'node', packages: 'external', format: 'esm', outfile: '.build/app.mjs' });
const { App } = await import('../.build/app.mjs');
const client = await build({ ...options, entryPoints: ['src/client.jsx'], minify: true, write: false, format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' } });
const code = client.outputFiles[0].contents;
const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
const bundle = `archi-${hash}.js`;
await writeFile('dist/' + bundle, code);

const routes = ['index.json', 'blog.json', 'terms.json', 'privacy-policy.json', ...(await readdir('content/blog')).map(file => 'blog/' + file)];
await mkdir('dist/blog', { recursive: true });
for (const route of routes) {
  const { head, ...content } = JSON.parse(await readFile('content/' + route, 'utf8'));
  if (route === 'index.json') compileBlogTemplate(content.blog, 'home');
  if (route === 'blog.json') compileBlogTemplate(content.body, 'blog');
  const page = { ...content, buildYear: new Date().getFullYear() };
  const markup = renderToString(createElement(App, { page }));
  const data = JSON.stringify(page).replaceAll('<', '\\u003c');
  const prefix = page.kind === 'article' ? '../' : './';
  const publicPath = route === 'index.json' ? '/' : '/' + route.replace(/\.json$/, '.html');
  const image = content.body?.match(/class="article-hero" src="([^"]+)"/)?.[1] || '/assets/logo-original.png';
  const imageUrl = new URL(image, 'https://archi-create.com.ua' + publicPath).href;
  const description = head.match(/<meta name="description" content="([^"]*)"/)?.[1] || '';
  const social = '<meta property="og:image" content="' + imageUrl + '">'
    + '<meta property="og:description" content="' + description + '">'
    + '<meta property="og:url" content="https://archi-create.com.ua' + publicPath + '">';
  const html = `<!doctype html>
<html lang="uk">
<head>${head}${social}<link rel="canonical" href="https://archi-create.com.ua${publicPath}"><link rel="stylesheet" href="/site-palette.css"></head>
<body><div id="app">${markup}</div>
<script id="page-data" type="application/json">${data}</script>
<script type="module" src="${prefix}${bundle}"></script>
</body></html>
`;
  await writeFile('dist/' + route.replace(/\.json$/, '.html'), html);
}
console.log(`Built ${routes.length} pages and ${bundle} (${code.length} bytes).`);

await writeBackupBuild();
