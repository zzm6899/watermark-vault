import { ArrowRight, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ALBUM_WORKFLOW_STEPS, type AlbumWorkflowSummary } from "@/lib/album-workflow";

export default function AlbumWorkflowProgress({
  summary, onContinue, compact = false,
}: {
  summary: AlbumWorkflowSummary;
  onContinue?: () => void;
  compact?: boolean;
}) {
  const readiness = summary.stage === "archived"
    ? "Archived"
    : summary.delivered
      ? "Delivery complete"
      : summary.blockerCount > 0
        ? `${summary.blockerCount} blocker${summary.blockerCount === 1 ? "" : "s"}`
        : summary.warningCount > 0
          ? `${summary.warningCount} warning${summary.warningCount === 1 ? "" : "s"}`
          : "Checks clear";

  return <section aria-label="Album workflow" className={compact ? "studio-album-workflow space-y-1.5" : "studio-album-workflow space-y-3"}>
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{summary.label}</p>
        {!compact && <p className="mt-0.5 text-[11px] text-muted-foreground">{summary.detail}</p>}
      </div>
      <span className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-body ${summary.blockerCount ? "text-destructive" : summary.warningCount ? "text-amber-400" : "text-muted-foreground"}`}>
        {summary.stage !== "archived" && (summary.blockerCount || summary.warningCount) > 0 && <TriangleAlert className="size-3" />}{readiness}
      </span>
    </div>

    <ol aria-label="Photos, proofing, finals, delivery" className={`grid grid-cols-4 gap-1 ${compact ? "" : "gap-2"}`}>
      {ALBUM_WORKFLOW_STEPS.map((step, index) => {
        const state = summary.stage === "archived" ? "upcoming" : summary.delivered || index < summary.progressIndex ? "complete" : index === summary.progressIndex ? "current" : "upcoming";
        return <li key={step.id} aria-current={state === "current" ? "step" : undefined} data-step-state={state} className="min-w-0">
          <div className={`h-0.5 ${state === "complete" ? "bg-foreground/65" : state === "current" ? "bg-primary" : "bg-border"}`} />
          <p className={`mt-1 truncate text-[9px] font-body ${compact ? "sr-only" : state === "current" ? "font-semibold text-primary" : state === "complete" ? "text-foreground/75" : "text-muted-foreground/55"}`}>{step.label}</p>
        </li>;
      })}
    </ol>

    {(!compact || onContinue) && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
      <p className="text-[11px] text-muted-foreground"><span className="text-foreground/75">Next:</span> {summary.nextAction}</p>
      {onContinue && <Button type="button" variant="ghost" size="sm" onClick={onContinue} className="h-8 gap-1 px-2 text-xs text-primary">
        Continue <ArrowRight className="size-3.5" />
      </Button>}
    </div>}
  </section>;
}
