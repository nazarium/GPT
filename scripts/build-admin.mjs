import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import './check-admin.mjs';

await mkdir('.build', { recursive: true });
await build({
  entryPoints: ['src/admin.jsx'], bundle: true, jsx: 'automatic', format: 'esm',
  outfile: '.build/admin.js', minify: true, define: { 'process.env.NODE_ENV': '"production"' },
});
const styles = await Promise.all(['scripts/admin.css', 'public/buttons.css', 'scripts/social-admin.css'].map(path => readFile(path, 'utf8')));
await writeFile('.build/admin.css', styles.join('\n'));
await writeFile('.build/admin.html', `<!doctype html>
<html lang="uk">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Адмін панель</title><link rel="stylesheet" href="/admin.css"></head>
<body><div id="admin"></div><script type="module" src="/admin.js"></script></body>
</html>
`);
const [html, script, style] = await Promise.all(
  ['html', 'js', 'css'].map(extension => readFile('.build/admin.' + extension, 'utf8')),
);
await writeFile('.build/admin-assets.mjs', 'export default ' + JSON.stringify({ html, script, style }) + ';\n');

const blog = JSON.parse(await readFile('content/blog.json', 'utf8'));
const articles = await Promise.all([...blog.body.matchAll(/<article class="blog-card">([\s\S]*?)<\/article>/g)].map(async ([, card]) => {
  const id = card.match(/href="blog\/([^"]+)\.html"/)[1];
  const article = JSON.parse(await readFile('content/blog/' + id + '.json', 'utf8'));
  const sections = article.body.match(/<div class="article-body">([\s\S]*?)<\/div>\s*(<div class="article-end">[\s\S]*?<\/div>)\s*<\/article>/);
  if (!sections) throw new Error('Cannot separate article body and navigation: ' + id);
  return {
    id, title: card.match(/<h3><a[^>]*>(.*?)<\/a><\/h3>/s)[1],
    date: card.match(/datetime="([^"]+)"/)[1],
    cover: card.match(/<img src="([^"]+)"/)?.[1] ?? '',
    excerpt: card.match(/<\/h3><p>(.*?)<\/p>/s)?.[1] ?? '',
    legacyBody: sections[1],
    navigation: sections[2],
  };
}));
if (articles.length !== (await readdir('content/blog')).length) throw new Error('Blog catalog is incomplete.');
await writeFile('.build/articles.mjs', 'export default ' + JSON.stringify(articles) + ';\n');
