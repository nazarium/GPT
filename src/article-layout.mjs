export function articleCoverLayout(markup) {
  return markup.replace(
    /<header class="article-heading">([\s\S]*?)(<h1>[\s\S]*?<\/h1>)<\/header>(<img class="article-hero"[^>]*>)/,
    (_, details, title, image) => '<header class="article-heading article-heading-covered">' + details
      + '</header><div class="article-cover-hero">' + image + title + '</div>',
  );
}
