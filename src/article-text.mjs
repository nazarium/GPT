export const escapeHtml = text => text.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export const textToHtml = text => text.split(/\n\s*\n/)
  .map(paragraph => '<p>' + escapeHtml(paragraph).replaceAll('\n', '<br>') + '</p>').join('');
