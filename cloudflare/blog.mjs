import { compileBlogTemplate } from '../src/blog-template.mjs';
import originals from '../.build/articles.mjs';
import home from '../content/index.json';
import blog from '../content/blog.json';
import { textToHtml } from '../src/article-text.mjs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server.browser';
import { App } from '../.build/app.mjs';
import { renderHomeTexts } from './home-texts.mjs';
import { articlePath, articleRoute } from '../src/article-address.mjs';

const blogTemplate = compileBlogTemplate(blog.body, 'blog');
const homeBlogTemplate = compileBlogTemplate(home.blog, 'home');

export { articleRoute };
export const originalArticles = originals;
const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const dateLabel = date => new Intl.DateTimeFormat('uk-UA', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(date));
const time = date => `<time datetime="${date}">${dateLabel(date)}</time>`;
const cover = (article, className = '') => article.cover ? `<img ${className ? 'class="' + className + '"' : 'loading="lazy"'} src="/${escape(article.cover)}" alt="${escape(article.title)}">` : '';
const articleUrl = articlePath;
const card = article => {
  const title = escape(article.title);
  const href = articleUrl(article);
  return `<article class="blog-card">${article.cover ? `<a class="blog-cover" href="${href}" aria-label="${title}">${cover(article)}</a>` : ''}<div class="blog-meta">${time(article.date)}</div><h3><a href="${href}">${title}</a></h3><p>${escape(article.excerpt)}</p><a class="blog-read" href="${href}">Читати статтю <span aria-hidden="true">↗</span></a></article>`;
};
export const articleBody = (article, visibleArticles) => {
  const body = article.bodyHtml ?? (article.text === undefined ? article.legacyBody : textToHtml(article.text));
  let markup = `<article class="article-page"><header class="article-heading"><a href="/blog.html" class="article-back">← Усі статті</a><div class="blog-meta">${time(article.date)}<span>Archi-Create</span></div><h1>${escape(article.title)}</h1></header>${cover(article, 'article-hero')}<div class="article-body">${body}</div>${article.navigation ?? ''}</article>`;
  markup = markup.replace(/\b(href|src)="([^"]+)"/g, (attribute, name, value) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) return attribute;
    const target = new URL(value.replaceAll('&amp;', '&'), 'https://archi-create.com.ua/blog/');
    return name + '="' + escape(target.pathname + target.search + target.hash) + '"';
  });
  if (visibleArticles) {
    const ids = new Set(visibleArticles.map(item => item.id));
    markup = markup.replace(/<a\b[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/g, (link, href) => {
      const target = new URL(href, 'https://archi-create.com.ua/blog/');
      const match = target.origin === 'https://archi-create.com.ua' && articleRoute.exec(target.pathname);
      return match && /^article-/.test(match[1]) && !ids.has(match[1]) ? '' : link;
    });
  }
  return markup;
};

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function renderBlog(response, rewriter, path, articles, article, projects, homeSettings) {
  let page;
  let markup;
  if (article) {
    markup = articleBody(article, articles);
    page = { kind: 'article', body: markup };
    for (const [selector, attribute] of [['script[src]', 'src'], ['link[href]', 'href']]) {
      rewriter.on(selector, { element(element) {
        const value = element.getAttribute(attribute);
        if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) return;
        const target = new URL(value, value.startsWith('assets/') ? 'https://archi-create.com.ua/' : 'https://archi-create.com.ua/blog/');
        element.setAttribute(attribute, target.pathname + target.search + target.hash);
      } });
    }
    rewriter.on('link[rel="canonical"]', { element: element => element.setAttribute('href', 'https://archi-create.com.ua' + articleUrl(article)) });
    rewriter.on('title', { element: element => element.setInnerContent(article.title + ' — Archi-Create') });
    rewriter.on('meta[name="description"]', { element: element => element.setAttribute('content', article.excerpt) });
    const metadata = {
      'og:title': article.title, 'og:description': article.excerpt,
      'og:url': 'https://archi-create.com.ua' + articleUrl(article),
      'og:image': 'https://archi-create.com.ua/' + (article.cover || 'assets/logo-original.png'),
    };
    for (const [property, content] of Object.entries(metadata)) {
      rewriter.on('meta[property="' + property + '"]', { element: element => element.setAttribute('content', content) });
    }
  } else if (path === '/blog.html') {
    markup = blogTemplate(articles.length, articles.map(card).join(''));
    page = { kind: 'blog', body: markup };
  } else {
    const { title, description, image } = homeSettings.social;
    rewriter.on('head', { element: element => element.append(
      '<meta property="og:title" content="' + escape(title) + '">'
      + '<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">',
      { html: true }) });
    rewriter.on('meta[property="og:description"]', { element: element => element.setAttribute('content', description) });
    rewriter.on('meta[property="og:image"]', { element: element => element.setAttribute('content', 'https://archi-create.com.ua/' + image) });
    const selectedArticles = homeSettings.order.articles === 'random' ? shuffle(articles) : articles;
    const selectedProjects = homeSettings.order.projects === 'random' ? shuffle(projects) : projects;
    markup = homeBlogTemplate(articles.length, selectedArticles.slice(0, homeSettings.order.articleCount).map(card).join(''));
    const { head, ...content } = home;
    const edited = homeSettings.copy.revision ? renderHomeTexts(homeSettings.copy.texts) : {};
    page = { ...content, ...edited, blog: markup, projects: selectedProjects, projectCount: homeSettings.order.projectCount,
      projectCategories: homeSettings.tools?.categories, heroSlides: homeSettings.slides, heroTiming: homeSettings.timing, contacts: homeSettings.contacts,
      contactBot: homeSettings.contactBot };
  }
  return renderApp(response, rewriter, page);
}

export function renderApp(response, rewriter, page) {
  page.buildYear = new Date().getFullYear();
  const serialized = JSON.stringify(page).replaceAll('<', '\\u003c');
  const headers = new Headers(response.headers);
  headers.delete('ETag');
  headers.set('Cache-Control', 'no-store');
  return rewriter.on('#app', { element: element => element.setInnerContent(renderToString(createElement(App, { page })), { html: true }) })
    .on('#page-data', { element: element => element.setInnerContent(serialized, { html: true }) })
    .transform(new Response(response.body, { status: response.status, headers }));
}
