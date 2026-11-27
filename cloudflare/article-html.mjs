const tags = new Set(['p', 'div', 'br', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'span', 'small', 'cite']);
import { youtubeEmbedUrl } from '../src/youtube.mjs';
const discarded = new Set(['script', 'style', 'button', 'object', 'embed', 'svg', 'math', 'template', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'noscript', 'plaintext', 'listing']);

export async function sanitizeArticleHtml(html, allowEmpty = false, baseUrl = 'https://archi-create.com.ua/blog/') {
  if (typeof html !== 'string' || html.length > 80000) throw new Error('Текст завеликий або має некоректний формат.');
  let text = '';
  let videos = 0;
  const rewriter = new HTMLRewriter().on('*', {
    element(element) {
      if (element.tagName === 'iframe') {
        const source = youtubeEmbedUrl(element.getAttribute('src') || '');
        if (!source) return element.remove();
        for (const [name] of [...element.attributes]) element.removeAttribute(name);
        element.setAttribute('src', source);
        element.setAttribute('title', 'Відео YouTube');
        element.setAttribute('loading', 'lazy');
        element.setAttribute('allow', 'encrypted-media; picture-in-picture; fullscreen');
        element.setAttribute('allowfullscreen', '');
        videos++;
        return;
      }
      if (discarded.has(element.tagName)) return element.remove();
      if (!tags.has(element.tagName)) return element.removeAndKeepContent();
      const href = element.tagName === 'a' ? element.getAttribute('href') : null;
      const videoBlock = element.tagName === 'div' && element.getAttribute('class') === 'article-video';
      const textColor = element.tagName === 'span' && ['article-accent', 'article-color-default'].includes(element.getAttribute('class'))
        ? element.getAttribute('class') : null;
      for (const [name] of [...element.attributes]) element.removeAttribute(name);
      if (videoBlock) {
        element.setAttribute('class', 'article-video');
        element.setAttribute('contenteditable', 'false');
      }
      if (textColor) element.setAttribute('class', textColor);
      if (href) {
        try {
          const url = new URL(href, baseUrl);
          if (['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) element.setAttribute('href', url.href);
        } catch { /* Invalid links remain readable text. */ }
      }
    },
  });
  const clean = await rewriter.transform(new Response(html)).text();
  await new HTMLRewriter().on('*', { text(chunk) { text += chunk.text; } })
    .transform(new Response('<div>' + clean + '</div>')).text();
  if ((!allowEmpty && !videos && !text.replace(/&(?:nbsp|#160|#xA0);/gi, ' ').trim()) || text.length > 20000) {
    throw new Error('Текст має містити від 1 до 20 000 символів.');
  }
  return clean;
}
