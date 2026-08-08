export default function AlbumEditorSectionHeading({ id, title, detail, bordered = false, className = "" }: { id: string; title: string; detail: string; bordered?: boolean; className?: string }) {
  return <div id={id} className={`scroll-mt-40 ${bordered ? "border-t border-border/50 pt-5" : ""} ${className}`}>
    <p className="text-xs font-body uppercase tracking-[0.18em] text-primary">{title}</p>
    <p className="text-[11px] font-body text-muted-foreground mt-1">{detail}</p>
  </div>;
}
