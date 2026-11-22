import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = process.argv[2];
if (!source) throw new Error('Specify the directory of the original static site.');
const read = file => readFileSync(join(source, file), 'utf8');
const extract = (html, expression) => {
  const match = html.match(expression);
  if (!match) throw new Error(`Content missing: ${expression}`);
  return match[1];
};
const write = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
mkdirSync('content/blog', { recursive: true });
const context = { window: {} };
runInNewContext(read('portfolio.js'), context);
write('content/projects.json', context.window.archiPortfolio);

const home = read('index.html');
const homeSection = id => extract(home, new RegExp('<section id="' + id + '"[^>]*>([\\s\\S]*?)</section>'));
const head = html => extract(html, /<head>([\s\S]*?)<\/head>/).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
write('content/index.json', {
  head: head(home),
  kind: 'home',
  hero: extract(home, /<section class="hero"[^>]*>([\s\S]*?)<\/section>/),
  portfolioHeading: homeSection('projects').split('<div class="portfolio-toolbar">')[0],
  studio: homeSection('studio'),
  approach: homeSection('approach'),
  blog: homeSection('blog'),
  contactHeading: homeSection('contact').split('<div class="contact-layout">')[0],
  contactDetails: extract(homeSection('contact'), /<div class="contact-details">([\s\S]*?)<\/div><form/),
});
for (const file of ['blog.html', ...readdirSync(join(source, 'blog')).filter(file => file.endsWith('.html')).map(file => 'blog/' + file)]) {
  const html = read(file);
  write('content/' + file.replace(/\.html$/, '.json'), {
    head: head(html),
    kind: file === 'blog.html' ? 'blog' : 'article',
    body: extract(html, /<main>([\s\S]*?)<\/main>/),
  });
}
