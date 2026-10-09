import { AlertTriangle, ArrowUpRight, CalendarDays, CircleDot, Clock3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Album, Booking } from "@/lib/types";

export type DashboardDeliveryTask = {
  id: string;
  booking: Booking;
  album: Album | null;
  stageLabel: string;
  actionLabel: string;
  detail: string;
  ageLabel: string;
  tone: "urgent" | "waiting" | "active";
};

type DashboardCommandCenterProps = {
  state: "loading" | "error" | "ready";
  errorMessage?: string;
  nextSession: Booking | null;
  nextSessionEventLabel?: string;
  deliveryTasks: DashboardDeliveryTask[];
  onRetry?: () => void;
  onOpenSession: (booking: Booking) => void;
  onOpenBookings: () => void;
  onOpenDeliveryQueue?: () => void;
  onOpenDeliveryTask: (task: DashboardDeliveryTask) => void;
};

function formatSessionDate(date: string): { day: string; month: string; label: string } {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return { day: "—", month: "", label: date || "Date not set" };
  return {
    day: new Intl.DateTimeFormat("en-AU", { day: "2-digit" }).format(parsed),
    month: new Intl.DateTimeFormat("en-AU", { month: "short" }).format(parsed),
    label: new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long" }).format(parsed),
  };
}

function LoadingPanel() {
  return <section aria-label="Loading dashboard priorities" aria-busy="true" className="mb-7 border-y border-border/70 py-5">
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3"><div className="h-3 w-28 animate-pulse bg-secondary" /><div className="h-6 w-48 animate-pulse bg-secondary" /><div className="h-4 w-64 animate-pulse bg-secondary" /></div>
      <div className="space-y-3"><div className="h-4 w-36 animate-pulse bg-secondary" /><div className="h-10 animate-pulse bg-secondary" /><div className="h-10 animate-pulse bg-secondary" /></div>
    </div>
    <span className="sr-only" role="status">Loading your next session and delivery queue</span>
  </section>;
}

export default function DashboardCommandCenter({
  state, errorMessage, nextSession, nextSessionEventLabel, deliveryTasks, onRetry, onOpenSession, onOpenBookings, onOpenDeliveryQueue, onOpenDeliveryTask,
}: DashboardCommandCenterProps) {
  if (state === "loading") return <LoadingPanel />;

  if (state === "error") return <section role="alert" className="mb-7 flex flex-col gap-3 border-y border-destructive/30 py-4 sm:flex-row sm:items-center sm:justify-between">
    <div><h3 className="text-sm font-medium text-foreground">Dashboard priorities could not load</h3><p className="mt-1 text-sm text-muted-foreground">{errorMessage || "Check your connection or local storage, then retry."}</p></div>
    {onRetry && <Button variant="outline" onClick={onRetry} className="gap-2 self-start sm:self-auto"><RefreshCw className="size-4" /> Retry</Button>}
  </section>;

  const sessionDate = nextSession ? formatSessionDate(nextSession.date) : null;
  const taskCount = deliveryTasks.length;
  const visibleTasks = deliveryTasks.slice(0, 3);

  return <section aria-label="Your next work" className="dashboard-work mb-7 border-y border-border/70">
    <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="min-w-0 border-b border-border/70 py-4 sm:py-5 lg:border-b-0 lg:border-r lg:pr-8">
        <p className="mb-3 text-xs font-medium text-muted-foreground">Next session</p>
        {nextSession && sessionDate ? <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="w-12 shrink-0 border-r border-border/70 pr-3 text-center tabular-nums">
              <span className="block text-2xl leading-none text-foreground">{sessionDate.day}</span>
              <span className="mt-1 block text-[11px] text-muted-foreground">{sessionDate.month}</span>
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-xl font-medium leading-tight text-foreground">{nextSession.clientName || "Upcoming client"}</h3>
              <p className="mt-1 truncate text-sm text-muted-foreground">{nextSessionEventLabel || nextSession.type || "Photography session"}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" />{sessionDate.label}</span>
                <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />{nextSession.time || "Time not set"}</span>
                <span className="capitalize">{nextSession.status}</span>
              </div>
            </div>
          </div>
          <Button variant="outline" onClick={() => onOpenSession(nextSession)} className="h-9 gap-2 px-3 text-sm">Open session day <ArrowUpRight className="size-3.5" /></Button>
        </div> : <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">No upcoming sessions</p>
          <Button onClick={onOpenBookings} className="h-9 px-3 text-sm">Add a booking</Button>
        </div>}
      </div>

      <div className="min-w-0 py-4 sm:py-5 lg:pl-8">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium text-foreground">Delivery queue</h3>
          <span className="rounded-full border border-border/70 bg-secondary/40 px-2.5 py-1 text-xs tabular-nums text-muted-foreground">{taskCount} {taskCount === 1 ? "item" : "items"}</span>
        </div>
        {taskCount ? <ol className="mt-3 space-y-2.5">
          {visibleTasks.map(task => {
            const ToneIcon = task.tone === "urgent" ? AlertTriangle : task.tone === "waiting" ? Clock3 : CircleDot;
            return <li key={task.id} className={`grid min-w-0 gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${task.tone === "urgent" ? "border-primary/35 bg-primary/[0.045]" : "border-border/70 bg-background/35"}`}>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">{task.album?.title || task.booking.clientName || "Unassigned session"}</p>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] leading-none ${task.tone === "urgent" ? "border-primary/30 bg-primary/10 text-primary" : "border-border/70 bg-secondary/50 text-muted-foreground"}`}>
                    <ToneIcon aria-hidden="true" className="size-3" />{task.stageLabel}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground">
                  <span className="font-medium text-foreground/75">{task.ageLabel}</span>
                  <span aria-hidden="true" className="text-border">·</span>
                  <span className="min-w-0">{task.detail}</span>
                </div>
              </div>
              <Button type="button" size="sm" variant={task.tone === "urgent" ? "default" : "outline"} onClick={() => onOpenDeliveryTask(task)} className="h-9 w-full justify-between gap-3 px-3 text-xs sm:w-auto sm:min-w-36">
                {task.actionLabel}<ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
              </Button>
            </li>;
          })}
        </ol> : <p className="mt-3 border-t border-border/70 pt-3 text-sm text-muted-foreground">No unfinished deliveries.</p>}
        {taskCount > visibleTasks.length && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
          <p className="text-xs text-muted-foreground">Showing {visibleTasks.length} of {taskCount}</p>
          <Button type="button" size="sm" variant="ghost" onClick={onOpenDeliveryQueue || onOpenBookings} className="h-8 px-2 text-xs">View full queue<ArrowUpRight aria-hidden="true" className="ml-1 size-3.5" /></Button>
        </div>}
      </div>
    </div>
  </section>;
}
