// Compile trusted legacy fragments once; fail explicitly if their structure changes.
export function compileBlogTemplate(template, kind) {
  const counter = kind === 'blog' ? /<span>\d+ стаття<\/span>/g : /Усі статті · \d+/g;
  const cards = /<article class="blog-card">[\s\S]*<\/article>/;
  if ([...template.matchAll(counter)].length !== 1 || !cards.test(template)) {
    throw new Error('Invalid ' + kind + ' blog template: expected one counter and a card section');
  }
  const marked = template.replace(counter, '{{article-count}}').replace(cards, '{{article-cards}}');
  return (count, markup) => marked.replace(/\{\{article-(count|cards)\}\}/g, (_, slot) =>
    slot === 'cards' ? markup : kind === 'blog' ? '<span>Статей: ' + count + '</span>' : 'Усі статті · ' + count);
}
