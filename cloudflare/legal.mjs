import terms from '../content/terms.json';
import privacy from '../content/privacy-policy.json';
import { renderApp } from './blog.mjs';

const pages = { terms, 'privacy-policy': privacy };
const bodyPattern = /(<div class="article-body">)[\s\S]*?(<\/div><\/article>)$/;

export function originalLegal(id) {
  return { revision: 0, bodyHtml: pages[id].body.match(/<div class="article-body">([\s\S]*?)<\/div><\/article>$/)[1] };
}

export function renderLegal(response, id, document) {
  const { head, ...page } = pages[id];
  page.body = page.body.replace(bodyPattern, (_, start, end) => start + document.bodyHtml + end);
  return renderApp(response, new HTMLRewriter(), page);
}
