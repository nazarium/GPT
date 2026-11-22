function selectedTextNodes(editor, range) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : node.length;
    if (end > start && node.textContent.slice(start, end).trim() && range.intersectsNode(node)
        && !node.parentElement.closest('[contenteditable="false"]')) nodes.push(node);
  }
  return nodes;
}

export function accentIsActive(editor, range) {
  if (!range || range.collapsed) return false;
  const nodes = selectedTextNodes(editor, range);
  return nodes.length > 0 && nodes.every(node =>
    node.parentElement.closest('.article-accent, .article-color-default')?.classList.contains('article-accent'));
}

export function toggleTextAccent(editor, range) {
  if (!range || range.collapsed || !range.toString().trim()) return;
  const className = accentIsActive(editor, range) ? 'article-color-default' : 'article-accent';
  const parts = selectedTextNodes(editor, range).map(node => ({
    node,
    start: range.startContainer === node ? range.startOffset : 0,
    end: range.endContainer === node ? range.endOffset : node.length,
  }));
  const selection = window.getSelection();
  const inserted = new Map();
  // Change text fragments independently so list items and other blocks stay intact.
  for (let index = parts.length - 1; index >= 0; index--) {
    const { node, start, end } = parts[index];
    const partRange = document.createRange();
    partRange.setStart(node, start);
    partRange.setEnd(node, end);
    selection.removeAllRanges();
    selection.addRange(partRange);
    const span = document.createElement('span');
    span.className = className;
    span.dataset.accentPart = String(index);
    span.textContent = node.textContent.slice(start, end);
    document.execCommand('insertHTML', false, span.outerHTML);
    const result = editor.querySelector('[data-accent-part="' + index + '"]');
    if (result) inserted.set(index, result);
  }
  const first = inserted.get(0);
  const last = inserted.get(parts.length - 1);
  for (const span of inserted.values()) span.removeAttribute('data-accent-part');
  if (!first || !last) return;
  const selectionRange = document.createRange();
  selectionRange.setStart(first, 0);
  selectionRange.setEnd(last, last.childNodes.length);
  selection.removeAllRanges();
  selection.addRange(selectionRange);
}
