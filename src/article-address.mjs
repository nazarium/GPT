export const articleRoute = /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|\.html)?$/;
export const articlePath = article => article.slug ? '/blog/' + article.slug + '/' : '/blog/' + article.id + '.html';

const transliteration = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye',
  ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '',
  ю: 'yu', я: 'ya', ы: 'y', э: 'e', ё: 'yo', ъ: '',
};

export function articleSlug(title) {
  return [...String(title || '').normalize('NFKC').toLowerCase()]
    .map(char => transliteration[char] ?? char).join('')
    .replace(/['’ʼ`]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 100).replace(/-$/g, '') || 'post01';
}

export function uniqueArticleSlug(title, occupied) {
  const base = articleSlug(title);
  let slug = base;
  let suffix = 2;
  while (occupied.has(slug)) {
    const ending = '-' + suffix++;
    slug = base.slice(0, 100 - ending.length).replace(/-$/g, '') + ending;
  }
  return slug;
}
