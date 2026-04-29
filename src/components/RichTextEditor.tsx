import { useRef, useCallback } from "react";
import { Bold, Italic, Heading2, Heading3, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import DOMPurify from "dompurify";

interface RichTextEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

const sanitizeRichText = (html: string) => DOMPurify.sanitize(html, {
  ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "h2", "h3"],
  ALLOWED_ATTR: [],
});

/**
 * A lightweight rich-text editor that stores content as HTML.
 * Uses `contentEditable` with `execCommand` for formatting.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Write something…",
  className = "",
  minHeight = "80px",
}: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Sync incoming `value` into the div only on first render / external reset.
  // We use a ref flag to avoid clobbering cursor position on every keystroke.
  const initialised = useRef(false);
  const syncRef = useCallback(
    (node: HTMLDivElement | null) => {
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      if (node && !initialised.current) {
        node.innerHTML = sanitizeRichText(value || "");
        initialised.current = true;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    ref.current?.focus();
    onChange(sanitizeRichText(ref.current?.innerHTML || ""));
  };

  const handleInput = () => {
    const raw = ref.current?.innerHTML || "";
    const clean = sanitizeRichText(raw);
    if (clean !== raw && ref.current) ref.current.innerHTML = clean;
    onChange(clean);
  };

  const toolbarBtnClass =
    "h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-secondary border-0 rounded";

  return (
    <div className={`rounded-md border border-border bg-secondary overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/60 bg-secondary/80">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarBtnClass}
          onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}
          title="Bold"
        >
          <Bold className="w-3.5 h-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarBtnClass}
          onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}
          title="Italic"
        >
          <Italic className="w-3.5 h-3.5" />
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarBtnClass}
          onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "h2"); }}
          title="Heading 2"
        >
          <Heading2 className="w-3.5 h-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarBtnClass}
          onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "h3"); }}
          title="Heading 3"
        >
          <Heading3 className="w-3.5 h-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarBtnClass}
          onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}
          title="Bullet list"
        >
          <List className="w-3.5 h-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary border-0"
          onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "p"); }}
          title="Normal text"
        >
          ¶
        </Button>
      </div>

      {/* Editable area */}
      <div
        ref={syncRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="px-3 py-2.5 text-sm font-body text-foreground focus:outline-none prose-sm prose-invert max-w-none
          [&_h2]:font-display [&_h2]:text-base [&_h2]:text-foreground [&_h2]:mb-1 [&_h2]:mt-2
          [&_h3]:font-display [&_h3]:text-sm [&_h3]:text-foreground [&_h3]:mb-1 [&_h3]:mt-2
          [&_b]:font-semibold [&_strong]:font-semibold
          [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1
          [&_li]:text-sm [&_li]:font-body
          empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/40 empty:before:pointer-events-none"
        style={{ minHeight }}
      />
    </div>
  );
}

/**
 * Renders stored HTML safely as read-only display.
 * Use this wherever you currently render {event.description} or {profile.bio}.
 */
export function RichTextDisplay({
  html,
  className = "",
}: {
  html: string;
  className?: string;
}) {
  if (!html) return null;
  // Check if it's plain text (no HTML tags) – render as-is with whitespace
  const isPlain = !/<[a-z][\s\S]*>/i.test(html);
  if (isPlain) {
    return (
      <p className={`text-sm font-body text-muted-foreground leading-relaxed whitespace-pre-line ${className}`}>
        {html}
      </p>
    );
  }
  return (
    <div
      className={`text-sm font-body text-muted-foreground leading-relaxed
        [&_h2]:font-display [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mb-1 [&_h2]:mt-2
        [&_h3]:font-display [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mb-1 [&_h3]:mt-1.5
        [&_b]:font-semibold [&_strong]:font-semibold [&_b]:text-foreground/90 [&_strong]:text-foreground/90
        [&_em]:italic [&_i]:italic
        [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1.5
        [&_li]:text-sm [&_li]:font-body [&_li]:text-muted-foreground
        [&_p]:mb-1.5 ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }}
    />
  );
}
