import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Copy, Download, ExternalLink, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/image-utils";
import { toast } from "sonner";
type ApkManifest = {
  appName?: string;
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  buildType?: string;
  builtAt?: string;
  commit?: string;
  apk?: {
    fileName?: string;
    url?: string;
    sizeBytes?: number;
    sha256?: string;
  };
  notes?: string[];
};

function ApkManagerView() {
  const [manifest, setManifest] = useState<ApkManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const loadManifest = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    try {
      const res = await fetch(`/downloads/android/latest.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        setManifest(null);
        setMissing(true);
        return;
      }
      setManifest(await res.json());
    } catch {
      setManifest(null);
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadManifest();
  }, [loadManifest]);

  const apkUrl = manifest?.apk?.url || "/downloads/android/latest.apk";
  // The APK path is intentionally cache-busted by build number. This prevents
  // a phone/browser or CDN from reopening a previously downloaded build after
  // the manifest has advanced.
  const apkHref = `${apkUrl}${apkUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(String(manifest?.versionCode || manifest?.commit || Date.now()))}`;
  const absoluteApkUrl = typeof window !== "undefined" ? new URL(apkHref, window.location.origin).toString() : apkHref;
  const builtAt = manifest?.builtAt ? new Date(manifest.builtAt) : null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(absoluteApkUrl);
      toast.success("App link copied");
    } catch {
      toast.error("Could not copy app link");
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-foreground">Android app</h2>
          <p className="text-xs font-body text-muted-foreground mt-1">
            Download the latest version of Zuploader Capture for Android.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadManifest} disabled={loading} className="gap-2 font-body text-xs">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="glass-panel rounded-xl p-5 sm:p-6">
        {loading ? (
          <p className="text-xs font-body text-muted-foreground">Checking for the latest version…</p>
        ) : missing ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-body font-medium text-foreground">The Android app is not available yet</p>
              <p className="text-xs font-body text-muted-foreground mt-1">
                Ask your website administrator to publish the latest app.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/25">
                  <Smartphone className="w-5 h-5" />
                </span>
                <div>
                  <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Latest version</p>
                  <h3 className="font-display text-xl text-foreground">{manifest?.appName || "Zuploader Capture"}</h3>
                  <p className="text-xs font-body text-muted-foreground mt-1">
                    Version {manifest?.versionName || "1.0"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild className="gap-2 font-body">
                  <a href={apkHref} download={manifest?.apk?.fileName || "zuploader-capture-latest.apk"}>
                    <Download className="w-4 h-4" /> Download app
                  </a>
                </Button>
                <Button variant="outline" onClick={copyLink} className="gap-2 font-body">
                  <Copy className="w-4 h-4" /> Copy Link
                </Button>
                <Button variant="outline" asChild className="gap-2 font-body">
                  <a href={apkHref} target="_blank" rel="noreferrer">
                    <ExternalLink className="w-4 h-4" /> Open
                  </a>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              <div className="rounded-lg border border-border/40 bg-secondary/30 p-3">
                <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Size</p>
                <p className="font-display text-lg text-foreground mt-1">{formatBytes(manifest?.apk?.sizeBytes || 0)}</p>
              </div>
              <div className="rounded-lg border border-border/40 bg-secondary/30 p-3">
                <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Updated</p>
                <p className="font-display text-sm text-foreground mt-1">{builtAt ? builtAt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Unknown"}</p>
              </div>
            </div>

            <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-4">
              <p className="text-sm font-body font-medium text-foreground">Install on your phone</p>
              <p className="text-xs font-body text-muted-foreground mt-1">
                Open this page on your Android phone and download the app. If prompted, allow your browser to install apps, then tap Install.
              </p>
            </div>

            {manifest?.notes?.length ? (
              <div className="space-y-2">
                <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Build notes</p>
                <div className="space-y-1">
                  {manifest.notes.map((note, index) => (
                    <p key={`${note}-${index}`} className="text-xs font-body text-muted-foreground flex gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" /> {note}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            {manifest?.apk?.sha256 && (
              <p className="text-[10px] font-mono text-muted-foreground/70 break-all">SHA-256: {manifest.apk.sha256}</p>
            )}
          </div>
        )}
      </div>
      <div className="glass-panel rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[10px] font-body uppercase tracking-wider text-primary">Desktop photo editing</p>
            <h3 className="font-display text-xl text-foreground mt-1">Lightroom Classic add-on</h3>
            <p className="text-xs font-body text-muted-foreground mt-1">Download the plugin to browse albums, sync client picks, and upload edited JPEG finals directly from Lightroom.</p>
          </div>
          <Button asChild variant="outline" className="gap-2 font-body shrink-0">
            <a href="/downloads/lightroom/WatermarkVault-Lightroom-Plugin.zip?v=2" download="WatermarkVault-Lightroom-Plugin.zip">
              <Download className="w-4 h-4" /> Download plugin
            </a>
          </Button>
        </div>
        <p className="mt-3 text-[10px] font-body text-muted-foreground/70">Install via Lightroom Classic → File → Plug-in Manager → Add, then configure your Watermark Vault URL and admin credentials.</p>
      </div>
    </motion.div>
  );
}

// ─── Email Automations Manager ───────────────────────

export default ApkManagerView;

