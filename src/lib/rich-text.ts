import DOMPurify from "dompurify";

export function normalizePlainRichText(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value.replace(/\u00a0/g, " ");
}

export function sanitizeRichText(html: string): string {
  const hasMarkup = /<[a-z][\s\S]*>/i.test(html);
  let prepared = html;
  if (!hasMarkup && /[\r\n]/.test(html)) {
    const escaped = document.createElement("div");
    escaped.textContent = normalizePlainRichText(html);
    prepared = escaped.innerHTML
      .split(/(?:\r?\n){2,}/)
      .map(paragraph => `<p>${paragraph.replace(/\r?\n/g, "<br>")}</p>`)
      .join("");
  } else if (hasMarkup) {
    // contentEditable uses divs as line blocks in several browsers. Drop any
    // div attributes and turn those blocks into paragraphs before sanitizing.
    prepared = prepared
      .replace(/<div\b[^>]*>/gi, "<p>")
      .replace(/<\/div\s*>/gi, "</p>");
  }

  const clean = DOMPurify.sanitize(prepared, {
    ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "h2", "h3", "a"],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
  const template = document.createElement("template");
  template.innerHTML = clean;

  // Defensive fallback for malformed markup that DOMPurify may have repaired.
  template.content.querySelectorAll("div").forEach(block => {
    const paragraph = document.createElement("p");
    while (block.firstChild) paragraph.appendChild(block.firstChild);
    block.replaceWith(paragraph);
  });

  template.content.querySelectorAll("a[href]").forEach(link => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });

  // Preserve existing anchors and make visible plain URLs useful without ever
  // treating their text as markup or accepting non-http schemes.
  const walker = document.createTreeWalker(template.content, document.defaultView?.NodeFilter.SHOW_TEXT ?? 4);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest("a") && /https?:\/\//i.test(node.data)) textNodes.push(node);
  }
  textNodes.forEach(node => {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of node.data.matchAll(/https?:\/\/[^\s<]+/gi)) {
      const start = match.index ?? 0;
      if (start > cursor) fragment.append(node.data.slice(cursor, start));
      const raw = match[0];
      const [, url = raw, punctuation = ""] = raw.match(/^(.*?)([),.!?;:]*)$/) || [];
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = url;
      fragment.append(anchor);
      if (punctuation) fragment.append(punctuation);
      cursor = start + raw.length;
    }
    if (cursor < node.data.length) fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  });
  return template.innerHTML;
}

/** Convert stored rich text into safe, readable plain text for calendar/email-style fields. */
export function richTextToPlainText(html: string): string {
  if (!html) return "";

  const template = document.createElement("template");
  template.innerHTML = sanitizeRichText(html);
  template.content.querySelectorAll("br").forEach(breakElement => {
    breakElement.replaceWith(document.createTextNode("\n"));
  });
  template.content.querySelectorAll("p, h2, h3, li").forEach(block => {
    block.append(document.createTextNode("\n"));
  });

  return (template.content.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
