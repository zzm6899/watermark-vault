import { useEffect, useState } from "react";
import { Archive, Clock3, Download, HardDrive, Images } from "lucide-react";

type ZipStats = {
  generated: number; downloaded: number; failed: number; photos: number; bytes: number;
  active: number; ready: number; averageBuildMs: number; readyTtlMs: number; transferredTtlMs: number;
  disk: { files: number; bytes: number };
};

function headers(): Record<string, string> {
  try {
    const creds = JSON.parse(localStorage.getItem("wv_admin") || "null");
    const hash = localStorage.getItem("wv_admin_session_hash") || (creds?.passwordHash?.startsWith("$2") ? "" : creds?.passwordHash);
    return creds?.username && hash ? { Authorization: `Basic ${btoa(`${creds.username}:${hash}`)}` } : {};
  } catch { return {}; }
}

const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
const duration = (value: number) => value >= 60_000 ? `${Math.floor(value / 60_000)}m ${Math.round(value % 60_000 / 1000)}s` : `${(value / 1000).toFixed(1)}s`;

export default function ZipOperationsPanel() {
  const [stats, setStats] = useState<ZipStats | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => fetch("/api/admin/zip-stats", { headers: headers(), cache: "no-store" }).then(r => r.ok ? r.json() : null).then(data => { if (active && data) setStats(data); }).catch(() => {});
    load(); const timer = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  if (!stats) return null;
  return <section className="mb-8 border-y border-border py-6">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-display text-2xl text-foreground">ZIP delivery</h3><p className="text-xs text-muted-foreground">Live packaging, transfer and temporary-disk usage.</p></div><p className="text-xs text-muted-foreground">{stats.active ? `${stats.active} preparing` : "No active jobs"} · {stats.ready} ready</p></div>
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-5">
      {[
        [Archive, stats.generated.toLocaleString(), "ZIPs prepared"],
        [Download, stats.downloaded.toLocaleString(), "Transfers completed"],
        [Images, stats.photos.toLocaleString(), "Photos packaged"],
        [Clock3, duration(stats.averageBuildMs), "Average build"],
        [HardDrive, `${stats.disk.files} · ${bytes(stats.disk.bytes)}`, "Temporary ZIPs"],
      ].map(([Icon, value, label], index) => <div className={`bg-card p-4 ${index === 4 ? "col-span-2 lg:col-span-1" : ""}`} key={String(label)}><Icon className="mb-3 h-4 w-4 text-primary" /><p className="font-display text-xl text-foreground">{String(value)}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{String(label)}</p></div>)}
    </div>
    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">ZIP files are temporary, not archived. Unclaimed ZIPs expire after {Math.round(stats.readyTtlMs / 60000)} minutes; completed transfers are removed after {Math.round(stats.transferredTtlMs / 60000)} minutes. Resized and watermarked image variants remain in the render cache for faster repeat preparation.</p>
  </section>;
}
