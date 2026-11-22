import { articlePath } from './article-address.mjs';

const stopWords = new Set('і й та а але або в у на з із зі до від для по під при про як що це таке його її їх цей ця ці за через між'.split(' '));
const genericWords = new Set(['будин', 'проєкт', 'будівниц', 'особлив', 'встанов', 'основн']);
const siteHosts = new Set(['archi-create.com.ua', 'www.archi-create.com.ua', 'archi-create.nazarium.workers.dev']);

function stem(word) {
  const normalized = word.toLocaleLowerCase('uk').replaceAll('проект', 'проєкт');
  if (normalized.startsWith('будин')) return 'будин';
  const shortened = normalized.replace(/(?:ення|ання|ями|ами|ого|ому|ові|еві|ів|ах|ях|ою|ий|ій|ом|ем|и|і|а|у|е|я|ю)$/u, '');
  return shortened.length >= 4 ? shortened : normalized;
}

function words(text) {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)]
    .filter(match => !stopWords.has(match[0].toLocaleLowerCase('uk')) && match[0].length >= 4)
    .map(match => ({ key: stem(match[0]), start: match.index, end: match.index + match[0].length }));
}

export function decodeArticleTitle(title) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = title;
  return textarea.value;
}

function textRuns(root) {
  const runs = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let run = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('a,button,script,style,[contenteditable="false"]')) { run = null; continue; }
    const block = node.parentElement.closest('p,h2,h3,h4,h5,h6,li,blockquote,div') || root;
    if (!run || run.block !== block) { run = { block, text: '', nodes: [] }; runs.push(run); }
    run.nodes.push({ node, start: run.text.length, end: run.text.length + node.length });
    run.text += node.textContent;
  }
  return runs;
}

function anchorMatch(runs, titleWords) {
  let best = null;
  for (const run of runs) {
    const tokens = words(run.text);
    for (let from = 0; from < tokens.length; from++) {
      for (let titleStart = 0; titleStart < titleWords.length; titleStart++) {
        let length = 0;
        while (length < 6 && tokens[from + length]?.key === titleWords[titleStart + length]?.key
            && titleStart + length < titleWords.length && from + length < tokens.length) length++;
        const key = tokens[from].key;
        const singleSpecificWord = key.length >= 8 && ![...genericWords].some(word => key.startsWith(word));
        if (length < 2 && !(length === 1 && singleSpecificWord)) continue;
        const start = tokens[from].start;
        const end = tokens[from + length - 1].end;
        if (end - start > 120 || best && best.length >= length) continue;
        best = { run, start, end, length, text: run.text.slice(start, end) };
      }
    }
  }
  return best;
}

export function articleAlreadyLinked(root, article) {
  const paths = new Set([articlePath(article), ...(article.paths || [])].map(path => path.replace(/\/$/, '')));
  return [...root.querySelectorAll('a[href]')].some(anchor => {
    try {
      const url = new URL(anchor.getAttribute('href'), 'https://archi-create.com.ua/blog/');
      return (siteHosts.has(url.hostname) || url.origin === location.origin) && paths.has(url.pathname.replace(/\/$/, ''));
    } catch { return false; }
  });
}

function contextVector(title, excerpt, body = '') {
  const vector = new Map();
  for (const [text, weight] of [[title, 4], [excerpt, 2], [body, 1]]) {
    const counts = new Map();
    for (const { key } of words(text || '')) counts.set(key, (counts.get(key) || 0) + 1);
    for (const [key, count] of counts) {
      const importance = [...genericWords].some(word => key.startsWith(word)) ? 0.25 : 1;
      vector.set(key, (vector.get(key) || 0) + weight * (1 + Math.log(count)) * importance);
    }
  }
  return vector;
}

function contextSimilarity(current, candidate, frequencies, documentCount) {
  let dot = 0;
  let currentSize = 0;
  let candidateSize = 0;
  const inverseFrequency = key => 1 + Math.log((documentCount + 1) / ((frequencies.get(key) || 0) + 1));
  for (const [key, weight] of current) {
    const value = weight * inverseFrequency(key);
    currentSize += value * value;
    dot += value * (candidate.get(key) || 0) * inverseFrequency(key);
  }
  for (const [key, weight] of candidate) candidateSize += (weight * inverseFrequency(key)) ** 2;
  return currentSize && candidateSize ? dot / Math.sqrt(currentSize * candidateSize) : 0;
}

export function findArticleCrosslinks(html, currentId, targets, context = {}) {
  const root = new DOMParser().parseFromString(html || '', 'text/html').body;
  const runs = textRuns(root);
  const current = contextVector(decodeArticleTitle(context.title || ''), context.excerpt, root.textContent);
  const currentTitle = new Set(words(context.title || '').map(word => word.key));
  const documents = targets.map(article => {
    const title = decodeArticleTitle(article.title);
    return { ...article, title, vector: contextVector(title, article.excerpt) };
  });
  const frequencies = new Map();
  for (const article of documents) {
    for (const key of article.vector.keys()) frequencies.set(key, (frequencies.get(key) || 0) + 1);
  }
  return documents.filter(article => article.id !== currentId && !articleAlreadyLinked(root, article)).map(article => {
    const { title, vector } = article;
    const titleWords = words(title);
    const common = [...vector.keys()].filter(key => current.has(key));
    const titleOverlap = titleWords.some(word => currentTitle.has(word.key)
      && ![...genericWords].some(generic => word.key.startsWith(generic)));
    const match = anchorMatch(runs, titleWords);
    return { ...article, anchor: match?.text || '',
      score: contextSimilarity(current, vector, frequencies, documents.length) * 100 + Math.min(match?.length || 0, 4) * 2,
      relevant: common.length >= 2 || match?.length >= 2 || match?.length === 1 && titleOverlap };
  }).filter(article => article.relevant)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'uk')).slice(0, 3);
}
