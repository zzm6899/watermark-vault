import { Fragment, type ReactNode } from "react";

/** Render client text as text, making only web URLs interactive. */
export default function LinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const urls = /(?:https?:\/\/|www\.)[^\s<>"']+?(?=https?:\/\/|[\s<>"']|$)/gi;
  let offset = 0;
  for (const match of text.matchAll(urls)) {
    let label = match[0].replace(/[.,!?;:]+$/, "");
    // Keep balanced parentheses in URLs but exclude surrounding punctuation.
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (label.endsWith(close) && label.split(close).length > label.split(open).length) label = label.slice(0, -1);
    }
    let href: string;
    try {
      const url = new URL(/^www\./i.test(label) ? `https://${label}` : label);
      if (!["https:", "http:"].includes(url.protocol) || !url.hostname) continue;
      href = url.href;
    } catch { continue; }
    const start = match.index!;
    parts.push(text.slice(offset, start));
    parts.push(<a key={start} href={href} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()} className="text-primary underline underline-offset-2 hover:opacity-80">{label}</a>);
    offset = start + label.length;
  }
  parts.push(text.slice(offset));
  return <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</span>;
}
