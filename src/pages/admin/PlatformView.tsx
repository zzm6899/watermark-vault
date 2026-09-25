import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Plus, Trash2, CreditCard, Camera, X, ChevronDown, ChevronUp, Copy, RefreshCw, RefreshCcw,
  CheckCircle2, Key, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { hashPassword } from "@/lib/storage";
import { formatBytes } from "@/lib/image-utils";
import {
  getLicenseKeys, generateLicenseKey, updateLicenseKeyStorageLimit, revokeLicenseKey, createTenant, updateTenant, deleteTenant,
  getSuperStats, getAllBookings, getLicensePlans, createLicensePlan, deleteLicensePlan,
  getLicensePurchases, getTenantSettings, saveTenantSettings, getSuperAdminWebhooks,
  getEventSlotRequests, confirmEventSlotRequest, rejectEventSlotRequest,
} from "@/lib/api";
import type {
  Booking, LicenseKey, Tenant, LicensePlan, LicensePurchase, TenantSettings, EventSlotRequest,
} from "@/lib/types";

// ─── Event Slot Requests Panel (Super Admin) ──────────
function EventSlotRequestsPanel() {
  const [requests, setRequests] = useState<(EventSlotRequest & { tenantDisplayName?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = async () => { setLoading(true); setRequests(await getEventSlotRequests()); setLoading(false); };
  useEffect(() => { load(); }, []);

  const handleConfirm = async (req: EventSlotRequest & { tenantDisplayName?: string }) => {
    if (!confirm(`Confirm extra event slot for ${req.tenantDisplayName || req.tenantSlug}? This will grant them one additional event type slot immediately.`)) return;
    setProcessingId(req.id);
    const { ok, error } = await confirmEventSlotRequest(req.id, "super-admin");
    setProcessingId(null);
    if (!ok) { toast.error(error || "Failed to confirm"); return; }
    toast.success("Slot granted!");
    load();
  };

  const handleReject = async (req: EventSlotRequest & { tenantDisplayName?: string }) => {
    if (!confirm(`Reject event slot request from ${req.tenantDisplayName || req.tenantSlug}?`)) return;
    setProcessingId(req.id);
    const { ok, error } = await rejectEventSlotRequest(req.id, "super-admin");
    setProcessingId(null);
    if (!ok) { toast.error(error || "Failed to reject"); return; }
    toast.success("Request rejected");
    load();
  };

  const statusBadge = (status: EventSlotRequest["status"]) => {
    switch (status) {
      case "pending": return <span className="text-[10px] font-body bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded-full">Pending</span>;
      case "paid": return <span className="text-[10px] font-body bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded-full">Paid — Awaiting Approval</span>;
      case "confirmed": return <span className="text-[10px] font-body bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded-full">Confirmed</span>;
      case "rejected": return <span className="text-[10px] font-body bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded-full">Rejected</span>;
    }
  };

  return (
    <div className="glass-panel rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base text-foreground flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-primary" /> Event Slot Requests
        </h3>
        <Button size="sm" variant="outline" onClick={load} className="font-body text-xs gap-1.5 border-border">
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>
      <p className="text-xs font-body text-muted-foreground">Tenants who have reached their event type limit can request an extra slot. Review and approve or reject each request here. The slot is only granted after you confirm.</p>
      {loading ? (
        <p className="text-xs font-body text-muted-foreground animate-pulse">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-xs font-body text-muted-foreground">No event slot requests yet.</p>
      ) : (
        <div className="space-y-2">
          {requests.map(r => (
            <div key={r.id} className="p-3 rounded-lg bg-secondary/30 border border-border/40 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-body font-medium text-foreground">{r.tenantDisplayName || r.tenantSlug}</span>
                    {statusBadge(r.status)}
                    <span className="text-[10px] font-body text-muted-foreground capitalize">{r.paymentMethod} payment</span>
                  </div>
                  <div className="text-[11px] font-body text-muted-foreground mt-0.5 flex flex-wrap gap-2">
                    <span>Requested: {new Date(r.requestedAt).toLocaleDateString("en-AU")}</span>
                    <span>· Amount: ${r.amount}</span>
                    {r.paidAt && <span>· Paid: {new Date(r.paidAt).toLocaleDateString("en-AU")}</span>}
                    {r.confirmedAt && r.confirmedBy && <span>· Confirmed by {r.confirmedBy}</span>}
                    {r.rejectedAt && r.rejectedBy && <span>· Rejected by {r.rejectedBy}</span>}
                  </div>
                  {r.paymentMethod === "bank" && ["pending", "paid"].includes(r.status) && (
                    <p className="text-[10px] font-body text-amber-500 mt-1">Bank transfer — verify payment in your account before confirming.</p>
                  )}
                </div>
                {["pending", "paid"].includes(r.status) && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" onClick={() => handleConfirm(r)} disabled={processingId === r.id} className="bg-green-600 hover:bg-green-700 text-white font-body text-xs gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleReject(r)} disabled={processingId === r.id} className="text-destructive hover:text-destructive hover:bg-destructive/10 font-body text-xs gap-1">
                      <X className="w-3 h-3" /> Reject
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── License Keys Panel ───────────────────────────────
function LicenseKeysPanel() {
  const [keys, setKeys] = useState<LicenseKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [newIssuedTo, setNewIssuedTo] = useState("");
  const [newExpiresAt, setNewExpiresAt] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newIsTrial, setNewIsTrial] = useState(false);
  const [newMaxEvents, setNewMaxEvents] = useState("");
  const [newMaxBookings, setNewMaxBookings] = useState("");
  const [newStorageLimitGb, setNewStorageLimitGb] = useState("");
  const [newExtraEventPrice, setNewExtraEventPrice] = useState("");
  const [editingStorageKey, setEditingStorageKey] = useState<string | null>(null);
  const [storageLimitInput, setStorageLimitInput] = useState("");
  const [savingStorageKey, setSavingStorageKey] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const loadKeys = async () => {
    setLoading(true);
    const result = await getLicenseKeys();
    setKeys(result);
    setLoading(false);
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleGenerate = async () => {
    if (!newIssuedTo.trim()) {
      toast.error("Issued To is required");
      return;
    }
    setGenerating(true);
    const parsePositiveInt = (s: string) => { const n = parseInt(s); return Number.isFinite(n) && n > 0 ? n : undefined; };
    const parsePositiveFloat = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : undefined; };
    const maxEvents = newMaxEvents.trim() ? parsePositiveInt(newMaxEvents) : undefined;
    const maxBookings = newMaxBookings.trim() ? parsePositiveInt(newMaxBookings) : undefined;
    const storageLimitGb = newStorageLimitGb.trim() ? Number(newStorageLimitGb) : undefined;
    if (newStorageLimitGb.trim() && (storageLimitGb === undefined || !Number.isFinite(storageLimitGb) || storageLimitGb <= 0)) { toast.error("Enter a positive storage limit in GB"); setGenerating(false); return; }
    const extraEventPrice = newExtraEventPrice.trim() ? parsePositiveFloat(newExtraEventPrice) : undefined;
    const { key, error } = await generateLicenseKey(
      newIssuedTo.trim(),
      newExpiresAt || undefined,
      newNotes || undefined,
      { isTrial: newIsTrial || undefined, maxEvents, maxBookings, storageLimitGb, extraEventPrice },
    );
    setGenerating(false);
    if (error || !key) {
      toast.error(error || "Failed to generate key");
      return;
    }
    toast.success(`Key generated: ${key.key}`);
    setNewIssuedTo(""); setNewExpiresAt(""); setNewNotes("");
    setNewIsTrial(false); setNewMaxEvents(""); setNewMaxBookings(""); setNewStorageLimitGb(""); setNewExtraEventPrice("");
    setKeys((prev) => [...prev, key]);
  };

  const handleRevoke = async (k: LicenseKey) => {
    if (!confirm(`Revoke key ${k.key} issued to ${k.issuedTo}?`)) return;
    const { ok, error } = await revokeLicenseKey(k.key);
    if (!ok) {
      toast.error(error || "Failed to revoke key");
      return;
    }
    toast.success("Key revoked");
    setKeys((prev) => prev.filter((x) => x.key !== k.key));
  };

  const saveStorageLimit = async (k: LicenseKey) => {
    const value = storageLimitInput.trim();
    const storageLimitGb = value ? Number(value) : null;
    if (storageLimitGb !== null && (!Number.isFinite(storageLimitGb) || storageLimitGb <= 0)) { toast.error("Enter a positive storage limit in GB"); return; }
    setSavingStorageKey(true);
    const result = await updateLicenseKeyStorageLimit(k.key, storageLimitGb);
    setSavingStorageKey(false);
    if (!result.key) { toast.error(result.error || "Could not update storage limit"); return; }
    setKeys(current => current.map(item => item.key === k.key ? result.key! : item));
    setEditingStorageKey(null);
    toast.success("Storage limit updated");
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => toast.success("Copied!")).catch(() => toast.error("Copy failed"));
  };

  const copySetupUrl = (setupToken: string) => {
    const url = `${window.location.origin}/tenant-setup/${setupToken}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Setup URL copied!")).catch(() => toast.error("Copy failed"));
  };

  const effectiveMaxEvents = (k: LicenseKey) => k.maxEvents ?? k.trialMaxEvents ?? null;
  const effectiveMaxBookings = (k: LicenseKey) => k.maxBookings ?? k.trialMaxBookings ?? null;

  return (
    <div className="glass-panel rounded-xl p-6 space-y-4">
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setExpanded((v) => !v)}
      >
        <h3 className="font-display text-base text-foreground flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" /> License Keys
        </h3>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="space-y-5">
          <p className="text-xs font-body text-muted-foreground">
            Generate license keys for tenant photographers. Each key includes a one-time setup URL you can send to the tenant — they use it to register their URL slug and configure their booking page.
          </p>

          {/* Generate new key */}
          <div className="space-y-3 p-4 rounded-lg bg-secondary/50 border border-border/50">
            <h4 className="text-xs font-body tracking-wider uppercase text-muted-foreground">Generate New Key</h4>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Issued To *</label>
              <Input
                value={newIssuedTo}
                onChange={(e) => setNewIssuedTo(e.target.value)}
                placeholder="e.g. Jane Smith or jane@example.com"
                className="bg-background border-border text-foreground font-body text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Expires (optional)</label>
                <Input
                  type="date"
                  value={newExpiresAt}
                  onChange={(e) => setNewExpiresAt(e.target.value)}
                  className="bg-background border-border text-foreground font-body text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Notes (optional)</label>
                <Input
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="e.g. Wedding photographer"
                  className="bg-background border-border text-foreground font-body text-sm"
                />
              </div>
            </div>

            {/* Free Trial Toggle */}
            <div className="flex items-center gap-3 pt-1">
              <Switch
                checked={newIsTrial}
                onCheckedChange={(v) => {
                  setNewIsTrial(v);
                  if (v) {
                    // Pre-fill classic trial defaults so limits are enforced immediately
                    if (!newMaxEvents.trim()) setNewMaxEvents("1");
                    if (!newMaxBookings.trim()) setNewMaxBookings("10");
                  } else {
                    // Clear defaults when un-marking as trial (only if they still match the defaults)
                    if (newMaxEvents === "1") setNewMaxEvents("");
                    if (newMaxBookings === "10") setNewMaxBookings("");
                  }
                }}
                id="trial-toggle"
              />
              <label htmlFor="trial-toggle" className="text-xs font-body text-foreground cursor-pointer">
                Mark as Free Trial
              </label>
              {newIsTrial && (
                <span className="text-[10px] font-body bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded-full">Trial</span>
              )}
            </div>

            {/* Plan limits (available for any key type) */}
            <div className="space-y-2 p-3 rounded-lg bg-secondary/50 border border-border/50">
              <p className="text-xs font-body text-muted-foreground">Usage limits (optional)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-body text-muted-foreground mb-1 block">Max Event Types</label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    value={newMaxEvents}
                    onChange={(e) => setNewMaxEvents(e.target.value)}
                    className="bg-background border-border text-foreground font-body text-sm"
                  />
                  <p className="text-[10px] font-body text-muted-foreground mt-0.5">Leave blank for unlimited</p>
                </div>
                <div>
                  <label className="text-xs font-body text-muted-foreground mb-1 block">Max Bookings</label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    value={newMaxBookings}
                    onChange={(e) => setNewMaxBookings(e.target.value)}
                    className="bg-background border-border text-foreground font-body text-sm"
                  />
                  <p className="text-[10px] font-body text-muted-foreground mt-0.5">Leave blank for unlimited</p>
                </div>
                <div>
                  <label className="text-xs font-body text-muted-foreground mb-1 block">Photo storage (GB)</label>
                  <Input type="number" min="0.01" step="0.01" placeholder="Unlimited" value={newStorageLimitGb} onChange={e => setNewStorageLimitGb(e.target.value)} className="bg-background border-border text-foreground font-body text-sm" />
                  <p className="text-[10px] font-body text-muted-foreground mt-0.5">Leave blank for unlimited</p>
                </div>
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Extra Event Slot Price ($)</label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 25 — leave blank to disable add-ons"
                  value={newExtraEventPrice}
                  onChange={(e) => setNewExtraEventPrice(e.target.value)}
                  className="bg-background border-border text-foreground font-body text-sm"
                />
                <p className="text-[10px] font-body text-muted-foreground mt-0.5">Price tenant pays to unlock one extra event type slot (Stripe or bank). Super admin must confirm each purchase.</p>
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2"
              size="sm"
            >
              <Key className="w-3 h-3" /> {generating ? "Generating…" : "Generate Key"}
            </Button>
          </div>

          {/* Key list */}
          <div className="space-y-2">
            {loading && <p className="text-xs font-body text-muted-foreground">Loading…</p>}
            {!loading && keys.length === 0 && (
              <p className="text-xs font-body text-muted-foreground">No license keys yet. Generate one above.</p>
            )}
            {keys.map((k) => (
              <div key={k.key} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg bg-secondary/30 border border-border/40">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-foreground tracking-widest">{k.key}</span>
                    <button onClick={() => copyKey(k.key)} className="text-muted-foreground hover:text-foreground">
                      <Copy className="w-3 h-3" />
                    </button>
                    {k.usedAt ? (
                      <span className="text-[10px] font-body bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded-full">Used</span>
                    ) : (
                      <span className="text-[10px] font-body bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Active</span>
                    )}
                    {k.isTrial && (
                      <span className="text-[10px] font-body bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded-full">Trial</span>
                    )}
                    {effectiveMaxEvents(k) != null && (
                      <span className="text-[10px] font-body bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">
                        {effectiveMaxEvents(k)} event{effectiveMaxEvents(k) !== 1 ? "s" : ""}
                      </span>
                    )}
                    {effectiveMaxBookings(k) != null && (
                      <span className="text-[10px] font-body bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">
                        {effectiveMaxBookings(k)} bookings
                      </span>
                    )}
                    {k.storageLimitGb != null && <span className="text-[10px] font-body bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">{k.storageLimitGb} GB storage</span>}
                    {k.extraEventPrice != null && (
                      <span className="text-[10px] font-body bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded-full">
                        +${k.extraEventPrice}/slot
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-body text-muted-foreground mt-0.5 flex flex-wrap gap-2">
                    <span>Issued to: {k.issuedTo}</span>
                    {k.expiresAt && <span>· Expires: {k.expiresAt.slice(0, 10)}</span>}
                    {k.usedAt && k.usedBy && <span>· Used by: {k.usedBy} on {k.usedAt.slice(0, 10)}</span>}
                    {k.notes && <span>· {k.notes}</span>}
                  </div>
                  {!k.usedAt && k.setupToken && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="text-[11px] font-body text-muted-foreground truncate max-w-[220px]">
                        {window.location.origin}/tenant-setup/{k.setupToken.slice(0, 8)}…
                      </span>
                      <button
                        onClick={() => copySetupUrl(k.setupToken!)}
                        className="text-[10px] font-body text-primary hover:text-primary/80 flex items-center gap-1 shrink-0"
                      >
                        <Copy className="w-3 h-3" /> Copy Setup URL
                      </button>
                    </div>
                  )}
                  {editingStorageKey === k.key && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="text-xs font-body text-muted-foreground">Storage limit (GB)
                        <Input type="number" min="0.01" step="0.01" value={storageLimitInput} onChange={event => setStorageLimitInput(event.target.value)} placeholder="Unlimited" className="mt-1 w-36 bg-background" />
                      </label>
                      <Button size="sm" onClick={() => void saveStorageLimit(k)} disabled={savingStorageKey}>{savingStorageKey ? "Saving…" : "Save limit"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingStorageKey(null)}>Cancel</Button>
                      <p className="w-full text-[11px] text-muted-foreground">Leave blank for unlimited. Existing photos remain if you lower a limit.</p>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" onClick={() => { setEditingStorageKey(editingStorageKey === k.key ? null : k.key); setStorageLimitInput(k.storageLimitGb != null ? String(k.storageLimitGb) : ""); }}>Storage</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(k)}
                  className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 font-body text-xs gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Revoke
                </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tenant Settings Panel ────────────────────────────
function TenantSettingsPanel({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const [settings, setSettings] = useState<TenantSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getTenantSettings(tenant.slug).then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, [tenant.slug]);

  const handleSave = async () => {
    setSaving(true);
    const { ok, error } = await saveTenantSettings(tenant.slug, settings);
    setSaving(false);
    if (!ok) { toast.error(error || "Failed to save"); return; }
    toast.success(`Settings saved for ${tenant.displayName}`);
    onClose();
  };

  const set = (patch: Partial<TenantSettings>) => setSettings((s) => ({ ...s, ...patch }));

  if (loading) return <div className="py-8 text-center text-xs font-body text-muted-foreground animate-pulse">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm text-foreground">
          Settings for <span className="text-primary">{tenant.displayName}</span>
          <span className="text-muted-foreground font-mono ml-1 text-[11px]">/{tenant.slug}</span>
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs font-body">✕ Close</button>
      </div>

      {/* ── Stripe ─────────────────────────────────── */}
      <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Stripe</span>
          {(() => {
            const stripeConfigured = !!(settings.stripePublishableKey || settings.stripeSecretKey || settings.stripeSecretKeySet);
            const stripeActive = settings.stripeEnabled !== false && stripeConfigured;
            return (
              <>
                <Switch checked={stripeActive} onCheckedChange={(v) => set({ stripeEnabled: v })} />
                <span className="text-xs font-body text-muted-foreground">{stripeActive ? "Enabled" : "Disabled"}</span>
              </>
            );
          })()}
        </div>
        <p className="text-[10px] font-body text-muted-foreground -mt-1">Tenant's own Stripe account — payments go directly to them.</p>
        <div>
          <label className="text-xs font-body text-muted-foreground mb-1 block">Publishable Key</label>
          <Input
            value={settings.stripePublishableKey || ""}
            onChange={(e) => set({ stripePublishableKey: e.target.value, stripeEnabled: true })}
            placeholder="pk_live_..."
            className="bg-background border-border text-foreground font-body text-xs font-mono"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-body text-muted-foreground">Secret Key</label>
            {settings.stripeSecretKeySet && !settings.stripeSecretKey && (
              <span className="text-[10px] font-body text-green-400">✓ Configured</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              value={settings.stripeSecretKey || ""}
              onChange={(e) => set({ stripeSecretKey: e.target.value, stripeEnabled: true })}
              placeholder={settings.stripeSecretKeySet ? "Enter new key to replace" : "sk_live_..."}
              className="bg-background border-border text-foreground font-body text-xs font-mono flex-1"
            />
            {settings.stripeSecretKeySet && !settings.stripeSecretKey && (
              <button onClick={() => set({ stripeSecretKey: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-body text-muted-foreground">Webhook Secret</label>
            {settings.stripeWebhookSecretSet && !settings.stripeWebhookSecret && (
              <span className="text-[10px] font-body text-green-400">✓ Configured</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              value={settings.stripeWebhookSecret || ""}
              onChange={(e) => set({ stripeWebhookSecret: e.target.value })}
              placeholder={settings.stripeWebhookSecretSet ? "Enter new secret to replace" : "whsec_..."}
              className="bg-background border-border text-foreground font-body text-xs font-mono flex-1"
            />
            {settings.stripeWebhookSecretSet && !settings.stripeWebhookSecret && (
              <button onClick={() => set({ stripeWebhookSecret: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
            )}
          </div>
          <p className="text-[10px] font-body text-muted-foreground mt-1">
            Set webhook URL to: <code className="bg-secondary px-1 rounded text-[10px]">/api/tenant/{tenant.slug}/stripe/webhook</code>
          </p>
        </div>
        <div>
          <label className="text-xs font-body text-muted-foreground mb-1 block">Currency</label>
          <Input
            value={settings.stripeCurrency || ""}
            onChange={(e) => set({ stripeCurrency: e.target.value.toLowerCase() })}
            placeholder="aud"
            maxLength={3}
            className="bg-background border-border text-foreground font-body text-xs font-mono w-24"
          />
          <p className="text-[10px] font-body text-muted-foreground mt-0.5">ISO 4217 code, e.g. aud, usd, gbp. Defaults to aud.</p>
        </div>
      </div>

      {/* ── Bank Transfer ──────────────────────────── */}
      <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Bank Transfer</span>
          <Switch
            checked={!!settings.bankTransferEnabled}
            onCheckedChange={(v) => set({ bankTransferEnabled: v })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Account Name</label>
            <Input value={settings.bankAccountName || ""} onChange={(e) => set({ bankAccountName: e.target.value })}
              placeholder="Jane Smith Photography" className="bg-background border-border text-foreground font-body text-xs" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">BSB</label>
            <Input value={settings.bankBsb || ""} onChange={(e) => set({ bankBsb: e.target.value })}
              placeholder="000-000" className="bg-background border-border text-foreground font-body text-xs" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Account Number</label>
            <Input value={settings.bankAccountNumber || ""} onChange={(e) => set({ bankAccountNumber: e.target.value })}
              placeholder="00000000" className="bg-background border-border text-foreground font-body text-xs" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">PayID</label>
            <Input value={settings.bankPayId || ""} onChange={(e) => set({ bankPayId: e.target.value })}
              placeholder="jane@example.com" className="bg-background border-border text-foreground font-body text-xs" />
          </div>
        </div>
        <div>
          <label className="text-xs font-body text-muted-foreground mb-1 block">Payment Instructions</label>
          <Input value={settings.bankInstructions || ""} onChange={(e) => set({ bankInstructions: e.target.value })}
            placeholder="Use your name as reference" className="bg-background border-border text-foreground font-body text-xs" />
        </div>
      </div>

      {/* ── Discord ────────────────────────────────── */}
      <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
        <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Discord</span>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-body text-muted-foreground">Webhook URL</label>
            {settings.discordWebhookUrlSet && !settings.discordWebhookUrl && (
              <span className="text-[10px] font-body text-green-400">✓ Configured</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={settings.discordWebhookUrl || ""}
              onChange={(e) => set({ discordWebhookUrl: e.target.value })}
              placeholder={settings.discordWebhookUrlSet ? "Enter new URL to replace" : "https://discord.com/api/webhooks/..."}
              className="bg-background border-border text-foreground font-body text-xs flex-1"
            />
            {settings.discordWebhookUrlSet && !settings.discordWebhookUrl && (
              <button onClick={() => set({ discordWebhookUrl: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
            )}
          </div>
          <p className="text-[10px] font-body text-muted-foreground mt-1">Notifications for this tenant's bookings will go to this webhook.</p>
        </div>
        <div className="flex flex-wrap gap-4">
          {([
            { key: "discordNotifyBookings", label: "Bookings" },
            { key: "discordNotifyDownloads", label: "Downloads" },
            { key: "discordNotifyProofing", label: "Proofing" },
          ] as { key: keyof TenantSettings; label: string }[]).map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <Switch
                checked={settings[key] !== false}
                onCheckedChange={(v) => set({ [key]: v })}
              />
              <label className="text-xs font-body text-foreground">{label}</label>
            </div>
          ))}
        </div>
      </div>

      {/* ── SMTP ──────────────────────────────────── */}
      <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
        <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Email SMTP</span>
        <p className="text-[10px] font-body text-muted-foreground -mt-1">Booking confirmation emails will be sent from this tenant's own email server.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">SMTP Host</label>
            <Input value={settings.smtpHost || ""} onChange={(e) => set({ smtpHost: e.target.value })}
              placeholder="smtp.gmail.com" className="bg-background border-border text-foreground font-body text-xs" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Port</label>
            <Input type="number" value={settings.smtpPort || ""} onChange={(e) => set({ smtpPort: parseInt(e.target.value) || undefined })}
              placeholder="587" className="bg-background border-border text-foreground font-body text-xs" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Username</label>
            <Input value={settings.smtpUser || ""} onChange={(e) => set({ smtpUser: e.target.value })}
              placeholder="jane@example.com" className="bg-background border-border text-foreground font-body text-xs" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-body text-muted-foreground">Password / App Password</label>
              {settings.smtpPasswordSet && !settings.smtpPassword && (
                <span className="text-[10px] font-body text-green-400">✓ Configured</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input type="password" value={settings.smtpPassword || ""} onChange={(e) => set({ smtpPassword: e.target.value })}
                placeholder={settings.smtpPasswordSet ? "Enter new password to replace" : "••••••••"} className="bg-background border-border text-foreground font-body text-xs flex-1" />
              {settings.smtpPasswordSet && !settings.smtpPassword && (
                <button onClick={() => set({ smtpPassword: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">From Address</label>
            <Input value={settings.smtpFrom || ""} onChange={(e) => set({ smtpFrom: e.target.value })}
              placeholder="Jane Smith <jane@example.com>" className="bg-background border-border text-foreground font-body text-xs" />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch checked={!!settings.smtpSecure} onCheckedChange={(v) => set({ smtpSecure: v })} />
            <label className="text-xs font-body text-foreground">Use TLS (port 465)</label>
          </div>
        </div>
      </div>

      {/* ── FTP Upload ────────────────────────────────── */}
      <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
        <div className="flex items-center justify-between">
          <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">FTP Upload</span>
          <Switch checked={!!settings.ftpEnabled} onCheckedChange={(v) => set({ ftpEnabled: v })} />
        </div>
        <p className="text-[10px] font-body text-muted-foreground -mt-1">Automatically send uploaded photos to an FTP server. Tagged photos will show an FTP badge.</p>
        {settings.ftpEnabled && (
          <>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">FTP Host / IP</label>
                <Input value={settings.ftpHost || ""} onChange={(e) => set({ ftpHost: e.target.value })}
                  placeholder="192.168.1.100" className="bg-background border-border text-foreground font-body text-xs" />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Port</label>
                <Input type="number" value={settings.ftpPort || ""} onChange={(e) => set({ ftpPort: parseInt(e.target.value) || undefined })}
                  placeholder="21" className="bg-background border-border text-foreground font-body text-xs" />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Username</label>
                <Input value={settings.ftpUser || ""} onChange={(e) => set({ ftpUser: e.target.value })}
                  placeholder="ftpuser" className="bg-background border-border text-foreground font-body text-xs" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-body text-muted-foreground">Password</label>
                  {settings.ftpPasswordSet && !settings.ftpPassword && (
                    <span className="text-[10px] font-body text-green-400">✓ Configured</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input type="password" value={settings.ftpPassword || ""} onChange={(e) => set({ ftpPassword: e.target.value })}
                    placeholder={settings.ftpPasswordSet ? "Enter new password to replace" : "••••••••"}
                    className="bg-background border-border text-foreground font-body text-xs flex-1" />
                  {settings.ftpPasswordSet && !settings.ftpPassword && (
                    <button onClick={() => set({ ftpPassword: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-body text-muted-foreground mb-1 block">Remote Path</label>
                <Input value={settings.ftpRemotePath || ""} onChange={(e) => set({ ftpRemotePath: e.target.value })}
                  placeholder="/photos" className="bg-background border-border text-foreground font-body text-xs" />
              </div>
            </div>
            {/* Folder organisation options */}
            <div className="space-y-2 pt-2 border-t border-border/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-body text-foreground">Organise by Album / Booking Type</p>
                  <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">Upload each album's photos into a sub-folder named after the album (e.g. <code>/photos/AlbumName/</code>).</p>
                </div>
                <Switch checked={!!settings.ftpOrganizeByAlbum} onCheckedChange={(v) => set({ ftpOrganizeByAlbum: v })} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-body text-foreground">Starred Photos → Separate Folder</p>
                  <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">When a photo is starred, move it on FTP to a <code>AlbumName-starred</code> sub-folder for easy sorting.</p>
                </div>
                <Switch checked={!!settings.ftpStarredFolder} onCheckedChange={(v) => set({ ftpStarredFolder: v })} />
              </div>
            </div>
          </>
        )}
      </div>

      <Button
        onClick={handleSave}
        disabled={saving}
        className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2 w-full"
        size="sm"
      >
        {saving ? "Saving…" : "Save Tenant Settings"}
      </Button>
    </div>
  );
}

// ─── Platform View (Super Admin Only) ────────────────
export default function PlatformView() {
  const [stats, setStats] = useState<{
    tenantCount: number; totalBookings: number; mainBookings: number;
    tenants: (Tenant & { bookingCount: number; pendingBookings: number; storageUsedBytes: number; storageFileCount: number; storageLimitBytes: number | null })[];
  } | null>(null);
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [plans, setPlans] = useState<LicensePlan[]>([]);
  const [purchases, setPurchases] = useState<LicensePurchase[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [activeSection, setActiveSection] = useState<"overview" | "bookings" | "tenants" | "keys" | "event-slots" | "plans" | "purchases" | "webhooks">("overview");
  const [selectedTenantForSettings, setSelectedTenantForSettings] = useState<Tenant | null>(null);

  // Tenant create form
  const [newTenantSlug, setNewTenantSlug] = useState("");
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantEmail, setNewTenantEmail] = useState("");
  const [newTenantLicenseKey, setNewTenantLicenseKey] = useState("");
  const [creatingTenant, setCreatingTenant] = useState(false);

  // Tenant password reset
  const [resettingSlug, setResettingSlug] = useState<string | null>(null);
  const [newTempPassword, setNewTempPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  // Tenant custom domain editing
  const [editingDomainSlug, setEditingDomainSlug] = useState<string | null>(null);
  const [customDomainInput, setCustomDomainInput] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);

  // Tenant event slot editing
  const [editingSlotSlug, setEditingSlotSlug] = useState<string | null>(null);
  const [slotRequestEnabled, setSlotRequestEnabled] = useState(false);
  const [slotPriceInput, setSlotPriceInput] = useState("");
  const [savingSlot, setSavingSlot] = useState(false);

  // Plan form state
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanPrice, setNewPlanPrice] = useState("");
  const [newPlanDuration, setNewPlanDuration] = useState("365");
  const [newPlanDesc, setNewPlanDesc] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);

  // Webhooks section
  const [webhooks, setWebhooks] = useState<{
    tenantSlug: string; displayName: string; discordWebhookUrl: string | null;
    discordNotifyBookings: boolean; discordNotifyDownloads: boolean;
    discordNotifyProofing: boolean; discordNotifyInvoices: boolean;
  }[] | null>(null);
  const [webhooksLoading, setWebhooksLoading] = useState(false);

  useEffect(() => {
    if (activeSection !== "webhooks" || webhooks !== null) return;
    setWebhooksLoading(true);
    getSuperAdminWebhooks().then(res => {
      setWebhooks(res.webhooks || []);
      setWebhooksLoading(false);
    });
  }, [activeSection, webhooks]);

  const loadAll = useCallback(() => {
    Promise.all([
      getSuperStats(), getAllBookings(), getLicensePlans(), getLicensePurchases(),
    ]).then(([s, bks, p, pur]) => {
      setStats(s);
      setAllBookings(bks);
      setPlans(p);
      setPurchases(pur);
      setLoadingStats(false);
    });
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleCreatePlan = async () => {
    const price = parseFloat(newPlanPrice);
    const durationDays = parseInt(newPlanDuration, 10);
    if (!newPlanName.trim() || isNaN(price) || price <= 0 || !Number.isFinite(durationDays) || durationDays <= 0) {
      toast.error("Name, price, and a valid duration are required");
      return;
    }
    setSavingPlan(true);
    const { plan, error } = await createLicensePlan({
      name: newPlanName.trim(),
      type: "one-time",
      price,
      currency: "AUD",
      durationDays,
      description: newPlanDesc.trim() || undefined,
    });
    setSavingPlan(false);
    if (error || !plan) { toast.error(error || "Failed"); return; }
    setPlans(prev => [...prev, plan]);
    setNewPlanName(""); setNewPlanPrice(""); setNewPlanDesc("");
    toast.success("Plan created");
  };

  const handleDeletePlan = async (id: string) => {
    if (!confirm("Delete this plan?")) return;
    const { ok } = await deleteLicensePlan(id);
    if (ok) setPlans(prev => prev.filter(p => p.id !== id));
    else toast.error("Failed to delete");
  };

  const handleCreateTenant = async () => {
    if (!newTenantSlug.trim() || !newTenantName.trim() || !newTenantLicenseKey.trim()) {
      toast.error("Slug, display name, and an unclaimed licence key are required");
      return;
    }
    setCreatingTenant(true);
    const { tenant, error } = await createTenant({
      slug: newTenantSlug.trim().toLowerCase(),
      displayName: newTenantName.trim(),
      email: newTenantEmail.trim() || "",
      licenseKey: newTenantLicenseKey.trim(),
    });
    setCreatingTenant(false);
    if (error || !tenant) { toast.error(error || "Failed to create tenant"); return; }
    toast.success(`Tenant /${tenant.slug} created — set a password before sharing the admin login`);
    setNewTenantSlug(""); setNewTenantName(""); setNewTenantEmail(""); setNewTenantLicenseKey("");
    loadAll();
  };

  const handleDeleteTenant = async (slug: string, displayName: string) => {
    if (!confirm(`Delete tenant "${displayName}" (/${slug})? This cannot be undone.`)) return;
    const { ok, error } = await deleteTenant(slug);
    if (!ok) { toast.error(error || "Failed to delete tenant"); return; }
    toast.success("Tenant deleted");
    loadAll();
  };

  const handleSetTenantPassword = async (slug: string) => {
    if (!newTempPassword.trim() || newTempPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setSettingPassword(true);
    try {
      const hashHex = await hashPassword(newTempPassword.trim());
      const { ok, error } = await updateTenant(slug, { passwordHash: hashHex });
      if (!ok) { toast.error(error || "Failed to update password"); return; }
      toast.success(`Password updated for /${slug}`);
      setResettingSlug(null);
      setNewTempPassword("");
    } catch { toast.error("Failed to update password"); }
    finally { setSettingPassword(false); }
  };

  const handleSaveCustomDomain = async (slug: string) => {
    setSavingDomain(true);
    const domain = customDomainInput.trim().toLowerCase().replace(/^https?:\/\//, "");
    const { ok, error } = await updateTenant(slug, { customDomain: domain || undefined });
    setSavingDomain(false);
    if (!ok) { toast.error(error || "Failed to save custom domain"); return; }
    toast.success(domain ? `Custom domain saved for /${slug}` : `Custom domain removed for /${slug}`);
    setEditingDomainSlug(null);
    setCustomDomainInput("");
    loadAll();
  };

  const handleSaveSlotSettings = async (slug: string) => {
    const trimmed = slotPriceInput.trim();
    const price = trimmed === "" ? undefined : parseFloat(trimmed);
    if (slotRequestEnabled && (price === undefined || isNaN(price) || price <= 0)) {
      toast.error("A valid price greater than 0 is required when event slot requests are enabled");
      return;
    }
    setSavingSlot(true);
    const { ok, error } = await updateTenant(slug, {
      extraEventSlotRequestEnabled: slotRequestEnabled,
      extraEventPrice: slotRequestEnabled && price !== undefined ? price : undefined,
    });
    setSavingSlot(false);
    if (!ok) { toast.error(error || "Failed to save slot settings"); return; }
    toast.success(`Event slot settings saved for /${slug}`);
    setEditingSlotSlug(null);
    setSlotPriceInput("");
    loadAll();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied!")).catch(() => toast.error("Copy failed"));
  };

  if (loadingStats) {
    return <div className="py-20 text-center"><div className="animate-pulse text-muted-foreground font-body text-sm">Loading platform data…</div></div>;
  }

  const sections = [
    { id: "overview", label: "Overview", shortLabel: "Home" },
    { id: "tenants", label: "Tenants", shortLabel: "Tenants" },
    { id: "keys", label: "License Keys", shortLabel: "Keys" },
    { id: "event-slots", label: "Event Slot Requests", shortLabel: "Slots" },
    { id: "plans", label: "License Plans", shortLabel: "Plans" },
    { id: "purchases", label: "Purchases", shortLabel: "Sales" },
    { id: "bookings", label: "All Bookings", shortLabel: "Bookings" },
    { id: "webhooks", label: "Webhooks", shortLabel: "Hooks" },
  ] as const;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-2 sm:gap-3">
        <Globe className="w-4 h-4 sm:w-5 sm:h-5 text-primary shrink-0" />
        <h2 className="font-display text-lg sm:text-xl text-foreground">Platform Admin</h2>
        <span className="text-[10px] font-body bg-primary/10 text-primary px-2 py-0.5 rounded-full shrink-0">Super Admin</span>
      </div>

      {/* Section navigation — scrollable on all screen sizes */}
      <div className="overflow-x-auto scrollbar-hide w-full">
        <div className="flex gap-1 p-1 bg-secondary rounded-xl min-w-max">
          {sections.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id as typeof activeSection)}
              className={`px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-body transition-all whitespace-nowrap flex-shrink-0 ${activeSection === s.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <span className="sm:hidden">{s.shortLabel}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Overview ── */}
      {activeSection === "overview" && (
        <div className="space-y-4 sm:space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {[
              { label: "Tenants", value: stats?.tenantCount ?? 0, sub: "active", onClick: () => setActiveSection("tenants") },
              { label: "Total Bookings", value: stats?.totalBookings ?? 0, sub: "all tenants", onClick: () => setActiveSection("bookings") },
              { label: "Main Bookings", value: stats?.mainBookings ?? 0, sub: "direct", onClick: undefined as (() => void) | undefined },
              { label: "License Plans", value: plans.length, sub: `${purchases.length} sold`, onClick: () => setActiveSection("plans") },
            ].map(s => s.onClick ? (
              <button key={s.label} onClick={s.onClick} className="glass-panel rounded-xl p-3 sm:p-4 text-left hover:ring-1 hover:ring-primary/30 transition-all w-full">
                <p className="text-[10px] sm:text-xs font-body tracking-wider uppercase text-muted-foreground leading-tight">{s.label}</p>
                <p className="font-display text-xl sm:text-2xl text-foreground mt-1">{s.value}</p>
                <p className="text-[10px] font-body text-muted-foreground">{s.sub}</p>
              </button>
            ) : (
              <div key={s.label} className="glass-panel rounded-xl p-3 sm:p-4">
                <p className="text-[10px] sm:text-xs font-body tracking-wider uppercase text-muted-foreground leading-tight">{s.label}</p>
                <p className="font-display text-xl sm:text-2xl text-foreground mt-1">{s.value}</p>
                <p className="text-[10px] font-body text-muted-foreground">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Quick Tenant List */}
          <div className="glass-panel rounded-xl p-4 sm:p-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="font-display text-base text-foreground">Tenants</h3>
              <button onClick={() => setActiveSection("tenants")} className="text-xs font-body text-primary hover:underline">Manage →</button>
            </div>
            {!stats?.tenants.length ? (
              <p className="text-sm font-body text-muted-foreground">No tenants yet. <button onClick={() => setActiveSection("tenants")} className="text-primary hover:underline">Create one</button></p>
            ) : (
              <div className="space-y-2">
                {stats.tenants.slice(0, 5).map(t => (
                  <div key={t.slug} className="flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 rounded-lg bg-secondary/50">
                    <Camera className="w-3.5 h-3.5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-body text-foreground truncate">{t.displayName}</p>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">/{t.slug}</p>
                    </div>
                    <span className="text-[10px] sm:text-xs font-body text-muted-foreground shrink-0">{t.bookingCount} bkgs</span>
                    <span className="text-[10px] sm:text-xs font-body text-muted-foreground shrink-0">{formatBytes(t.storageUsedBytes)}</span>
                  </div>
                ))}
                {stats.tenants.length > 5 && (
                  <p className="text-xs font-body text-muted-foreground text-center pt-1">+{stats.tenants.length - 5} more — <button onClick={() => setActiveSection("tenants")} className="text-primary hover:underline">view all</button></p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tenants ── */}
      {activeSection === "tenants" && (
        <div className="space-y-6">
          {/* Create tenant */}
          <div className="glass-panel rounded-xl p-6 space-y-4">
            <h3 className="font-display text-base text-foreground">Create New Tenant</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Slug * (URL identifier)</label>
                <Input value={newTenantSlug} onChange={e => setNewTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="jane-photography" className="bg-secondary border-border text-foreground font-body font-mono" />
                <p className="text-[10px] font-body text-muted-foreground mt-0.5">Booking URL: /book/{newTenantSlug || "slug"}</p>
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Display Name *</label>
                <Input value={newTenantName} onChange={e => setNewTenantName(e.target.value)} placeholder="Jane Smith Photography" className="bg-secondary border-border text-foreground font-body" />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Email</label>
                <Input type="email" value={newTenantEmail} onChange={e => setNewTenantEmail(e.target.value)} placeholder="jane@example.com" className="bg-secondary border-border text-foreground font-body" />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Licence Key *</label>
                <Input value={newTenantLicenseKey} onChange={e => setNewTenantLicenseKey(e.target.value)} placeholder="WV-XXXX-XXXX-XXXX-XXXX" className="bg-secondary border-border text-foreground font-body font-mono text-xs" />
                <p className="text-[10px] font-body text-muted-foreground mt-0.5">Use an active, unclaimed key issued from the Licences section.</p>
              </div>
            </div>
            <Button onClick={handleCreateTenant} disabled={creatingTenant} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2" size="sm">
              <Plus className="w-3 h-3" /> {creatingTenant ? "Creating…" : "Create Tenant"}
            </Button>
          </div>

          {/* Tenant list */}
          <div className="glass-panel rounded-xl p-6">
            <h3 className="font-display text-base text-foreground mb-4">All Tenants ({stats?.tenants.length ?? 0})</h3>
            {!stats?.tenants.length ? (
              <p className="text-sm font-body text-muted-foreground">No tenants yet. Create one above.</p>
            ) : (
              <div className="space-y-2">
                {stats.tenants.map(t => (
                  <div key={t.slug} className="space-y-0">
                    <div className="p-3 rounded-lg bg-secondary/50 border border-border/40 space-y-2">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                          <Camera className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-body text-foreground">{t.displayName}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">/{t.slug}</span>
                            {!t.active && <span className="text-[10px] font-body bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">Inactive</span>}
                          </div>
                          <p className="text-xs font-body text-muted-foreground truncate">{t.email}</p>
                          <p className="mt-1 text-xs font-body text-muted-foreground">{formatBytes(t.storageUsedBytes)} used{t.storageLimitBytes === null ? " · unlimited storage" : ` of ${formatBytes(t.storageLimitBytes)}`}{t.storageFileCount ? ` · ${t.storageFileCount} files` : ""}</p>
                          {t.storageLimitBytes !== null && <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-background" role="progressbar" aria-label={`${t.displayName} storage used`} aria-valuemin={0} aria-valuemax={t.storageLimitBytes} aria-valuenow={Math.min(t.storageUsedBytes, t.storageLimitBytes)}><div className={`h-full ${t.storageUsedBytes >= t.storageLimitBytes ? "bg-amber-400" : "bg-primary"}`} style={{ width: `${Math.min(100, t.storageUsedBytes / t.storageLimitBytes * 100)}%` }} /></div>}
                          {t.customDomain && (
                            <p className="text-[10px] font-mono text-blue-400 mt-0.5">🌐 {t.customDomain}</p>
                          )}
                          {t.extraEventSlotRequestEnabled && (
                            <p className="text-[10px] font-body text-amber-400 mt-0.5">🎟 Slots enabled{t.extraEventPrice != null ? ` — $${t.extraEventPrice}/slot` : ""}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-body text-foreground">{t.bookingCount} bookings</p>
                          {t.pendingBookings > 0 && <p className="text-[10px] font-body text-orange-400">{t.pendingBookings} pending</p>}
                        </div>
                        <button
                          onClick={() => copyToClipboard(`${window.location.origin}/book/${t.slug}`)}
                          className="text-muted-foreground hover:text-primary transition-colors shrink-0" title="Copy booking URL"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTenant(t.slug, t.displayName)}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0" title="Delete tenant"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => {
                            setResettingSlug(resettingSlug === t.slug ? null : t.slug);
                            setNewTempPassword("");
                            setSelectedTenantForSettings(null);
                            setEditingDomainSlug(null);
                            setEditingSlotSlug(null);
                          }}
                          className={`text-xs font-body px-2 py-1 rounded-md border transition-colors ${resettingSlug === t.slug ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}`}
                          title="Reset password"
                        >
                          🔑 Password
                        </button>
                        <button
                          onClick={() => {
                            const opening = editingDomainSlug !== t.slug;
                            setEditingDomainSlug(opening ? t.slug : null);
                            setCustomDomainInput(opening ? (t.customDomain || "") : "");
                            setResettingSlug(null);
                            setSelectedTenantForSettings(null);
                            setEditingSlotSlug(null);
                          }}
                          className={`text-xs font-body px-2 py-1 rounded-md border transition-colors ${editingDomainSlug === t.slug ? "bg-blue-500/10 text-blue-400 border-blue-500/30" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}`}
                          title="Custom domain"
                        >
                          🌐 Domain
                        </button>
                        <button
                          onClick={() => {
                            const opening = editingSlotSlug !== t.slug;
                            setEditingSlotSlug(opening ? t.slug : null);
                            setSlotRequestEnabled(opening ? (t.extraEventSlotRequestEnabled ?? false) : false);
                            setSlotPriceInput(opening && t.extraEventPrice != null ? String(t.extraEventPrice) : "");
                            setResettingSlug(null);
                            setSelectedTenantForSettings(null);
                            setEditingDomainSlug(null);
                          }}
                          className={`text-xs font-body px-2 py-1 rounded-md border transition-colors ${editingSlotSlug === t.slug ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}`}
                          title="Event slot request settings"
                        >
                          🎟 Slots
                        </button>
                        <button
                          onClick={() => {
                            setSelectedTenantForSettings(selectedTenantForSettings?.slug === t.slug ? null : t);
                            setEditingSlotSlug(null);
                          }}
                          className={`text-xs font-body px-2 py-1 rounded-md border transition-colors ${selectedTenantForSettings?.slug === t.slug ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"}`}
                          title="Configure tenant settings"
                        >
                          ⚙ Settings
                        </button>
                      </div>
                    </div>
                    {resettingSlug === t.slug && (
                      <div className="mt-1 p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                        <p className="text-xs font-body text-yellow-400 mb-2 font-medium">Set a new password for /{t.slug}</p>
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <Input
                              type="text"
                              value={newTempPassword}
                              onChange={e => setNewTempPassword(e.target.value)}
                              placeholder="New password (min 8 chars)"
                              className="bg-background border-border text-foreground font-body text-sm font-mono"
                            />
                          </div>
                          <Button size="sm" onClick={() => handleSetTenantPassword(t.slug)} disabled={settingPassword}
                            className="bg-yellow-600 hover:bg-yellow-700 text-white font-body text-xs gap-1 shrink-0">
                            {settingPassword ? "Saving…" : "Set Password"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setResettingSlug(null); setNewTempPassword(""); }}
                            className="font-body text-xs text-muted-foreground">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    {selectedTenantForSettings?.slug === t.slug && (
                      <div className="mt-1 p-4 rounded-lg bg-secondary/30 border border-primary/20">
                        <TenantSettingsPanel tenant={t} onClose={() => setSelectedTenantForSettings(null)} />
                      </div>
                    )}
                    {editingDomainSlug === t.slug && (
                      <div className="mt-1 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20 space-y-3">
                        <p className="text-xs font-body text-blue-400 font-medium">Custom domain for /{t.slug}</p>
                        <p className="text-[11px] font-body text-muted-foreground">
                          Enter the hostname your tenant will use (e.g. <code className="bg-secondary px-1 rounded">book.myphotobusiness.com</code>).
                          Point that domain's DNS to this server, then configure your reverse proxy (Caddy or nginx) to forward it here.
                        </p>
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <Input
                              type="text"
                              value={customDomainInput}
                              onChange={e => setCustomDomainInput(e.target.value.toLowerCase().replace(/^https?:\/\//, ""))}
                              placeholder="book.myphotobusiness.com"
                              className="bg-background border-border text-foreground font-body text-sm font-mono"
                            />
                          </div>
                          <Button size="sm" onClick={() => handleSaveCustomDomain(t.slug)} disabled={savingDomain}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-body text-xs gap-1 shrink-0">
                            {savingDomain ? "Saving…" : "Save"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingDomainSlug(null); setCustomDomainInput(""); }}
                            className="font-body text-xs text-muted-foreground">
                            Cancel
                          </Button>
                        </div>
                        {t.customDomain && (
                          <p className="text-[11px] font-body text-muted-foreground">
                            Current: <code className="bg-secondary px-1 rounded text-blue-400">{t.customDomain}</code>
                            {" — "}
                            <button onClick={() => { setCustomDomainInput(""); handleSaveCustomDomain(t.slug); }} className="text-destructive hover:underline">Remove</button>
                          </p>
                        )}
                      </div>
                    )}
                    {editingSlotSlug === t.slug && (
                      <div className="mt-1 p-4 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-3">
                        <p className="text-xs font-body text-amber-400 font-medium">Event slot requests for /{t.slug}</p>
                        <p className="text-[11px] font-body text-muted-foreground">
                          Enable to allow this tenant to purchase extra event type slots. The price set here overrides the license key price. If disabled or no price is set, the license key price will be used as a fallback (if available).
                        </p>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={slotRequestEnabled}
                            onCheckedChange={setSlotRequestEnabled}
                          />
                          <span className="text-xs font-body text-foreground">{slotRequestEnabled ? "Enabled" : "Disabled"}</span>
                        </div>
                        {slotRequestEnabled && (
                          <div>
                            <label className="text-xs font-body text-muted-foreground mb-1 block">Price per extra slot</label>
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={slotPriceInput}
                              onChange={e => setSlotPriceInput(e.target.value)}
                              placeholder="e.g. 29.00"
                              className="bg-background border-border text-foreground font-body text-sm font-mono max-w-[180px]"
                            />
                          </div>
                        )}
                        <div className="flex gap-2 items-center">
                          <Button size="sm" onClick={() => handleSaveSlotSettings(t.slug)} disabled={savingSlot}
                            className="bg-amber-600 hover:bg-amber-700 text-white font-body text-xs gap-1 shrink-0">
                            {savingSlot ? "Saving…" : "Save"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingSlotSlug(null); setSlotPriceInput(""); }}
                            className="font-body text-xs text-muted-foreground">
                            Cancel
                          </Button>
                          {t.extraEventSlotRequestEnabled && (
                            <span className="text-[10px] font-body text-amber-400 ml-auto">
                              Currently enabled — {t.extraEventPrice != null ? `$${t.extraEventPrice}/slot` : "license key price"}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── License Keys ── */}
      {activeSection === "keys" && (
        <div className="space-y-4">
          <LicenseKeysPanel />
        </div>
      )}

      {/* ── Event Slot Requests ── */}
      {activeSection === "event-slots" && <EventSlotRequestsPanel />}


      {activeSection === "bookings" && (
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground">All Bookings <span className="text-sm font-body text-muted-foreground font-normal">({allBookings.length} total)</span></h3>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {allBookings.length === 0 && <p className="text-sm font-body text-muted-foreground">No bookings yet.</p>}
            {[...allBookings].sort((a, b) => b.createdAt?.localeCompare(a.createdAt ?? "") ?? 0).map(bk => (
              <div key={bk.id} className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-secondary/40 border border-border/40 text-xs font-body">
                <div className="flex-1 min-w-0">
                  <span className="text-foreground font-medium">{bk.clientName}</span>
                  <span className="text-muted-foreground ml-2">{bk.date} @ {bk.time}</span>
                  {bk.type && <span className="text-muted-foreground ml-2">· {bk.type}</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {bk.tenantSlug ? (
                    <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px]">/{bk.tenantSlug}</span>
                  ) : (
                    <span className="bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full text-[10px]">main</span>
                  )}
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    bk.status === "confirmed" ? "bg-green-500/10 text-green-500"
                      : bk.status === "cancelled" ? "bg-destructive/10 text-destructive"
                      : "bg-orange-500/10 text-orange-500"
                  }`}>{bk.status || "pending"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── License Plans ── */}
      {activeSection === "plans" && (
        <div className="space-y-6">
          {/* Create plan */}
          <div className="glass-panel rounded-xl p-6 space-y-4">
            <h3 className="font-display text-base text-foreground">Create a Plan</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Plan Name *</label>
                <Input value={newPlanName} onChange={e => setNewPlanName(e.target.value)} placeholder="e.g. Starter, Pro" className="bg-secondary border-border text-foreground font-body" />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Billing Model</label>
                <div className="w-full bg-secondary border border-border text-foreground font-body text-sm rounded-md px-3 py-2.5">One-time purchase</div>
                <p className="text-[10px] font-body text-muted-foreground mt-1">Monthly and yearly subscriptions are not offered because automated renewals and cancellations are not supported.</p>
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Price (AUD) *</label>
                <Input type="number" value={newPlanPrice} onChange={e => setNewPlanPrice(e.target.value)} placeholder="29.00" className="bg-secondary border-border text-foreground font-body" />
              </div>
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Duration (days)</label>
                <Input type="number" min="1" value={newPlanDuration} onChange={e => setNewPlanDuration(e.target.value)} placeholder="365" className="bg-secondary border-border text-foreground font-body" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-body text-muted-foreground mb-1 block">Description (optional)</label>
                <Input value={newPlanDesc} onChange={e => setNewPlanDesc(e.target.value)} placeholder="What's included in this plan…" className="bg-secondary border-border text-foreground font-body" />
              </div>
            </div>
            <Button onClick={handleCreatePlan} disabled={savingPlan} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2" size="sm">
              <Plus className="w-3 h-3" /> {savingPlan ? "Creating…" : "Create Plan"}
            </Button>
          </div>

          {/* Plan list */}
          <div className="glass-panel rounded-xl p-6">
            <h3 className="font-display text-base text-foreground mb-4">Your Plans</h3>
            {plans.length === 0 ? (
              <p className="text-sm font-body text-muted-foreground">No plan templates yet. Create one above for manual licence administration.</p>
            ) : (
              <div className="space-y-3">
                {plans.map(p => (
                  <div key={p.id} className="flex items-center gap-3 p-4 rounded-lg bg-secondary/50 border border-border/40">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-body text-foreground font-medium">{p.name}</span>
                        <span className={`text-[10px] font-body px-1.5 py-0.5 rounded-full ${p.type === "one-time" ? "bg-primary/10 text-primary" : "bg-orange-500/10 text-orange-400"}`}>
                          {p.type === "one-time" ? "one-time" : `${p.type} · unsupported legacy`}
                        </span>
                        {!p.active && <span className="text-[10px] font-body bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">Inactive</span>}
                      </div>
                      <p className="text-xs font-body text-muted-foreground mt-0.5">
                        ${p.price} {p.currency}{p.type === "one-time" ? ` · ${p.durationDays} days` : ""}
                        {p.description && ` · ${p.description}`}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleDeletePlan(p.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10 font-body text-xs gap-1">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-panel rounded-xl p-6 space-y-2 border border-amber-500/20">
            <h3 className="font-display text-base text-foreground">Licence fulfilment</h3>
            <p className="text-xs font-body text-muted-foreground">
              Online licence checkout is disabled until a verified payment can be applied atomically to a specific tenant. Issue and attach licence keys directly from the admin tools instead.
            </p>
          </div>
        </div>
      )}

      {/* ── Purchases ── */}
      {activeSection === "purchases" && (
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground">License Purchases <span className="text-sm font-body text-muted-foreground font-normal">({purchases.length})</span></h3>
          {purchases.length === 0 ? (
            <p className="text-sm font-body text-muted-foreground">No purchases yet.</p>
          ) : (
            <div className="space-y-2">
              {[...purchases].sort((a, b) => b.createdAt?.localeCompare(a.createdAt ?? "") ?? 0).map(pur => (
                <div key={pur.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg bg-secondary/40 border border-border/40">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-body text-foreground">{pur.buyerEmail}</span>
                      <span className={`text-[10px] font-body px-1.5 py-0.5 rounded-full ${pur.status === "active" ? "bg-green-500/10 text-green-500" : "bg-orange-500/10 text-orange-500"}`}>{pur.status}</span>
                      <span className="text-[10px] font-body text-muted-foreground">{pur.method}</span>
                    </div>
                    <p className="text-xs font-body text-muted-foreground">{pur.planName} · ${pur.amount} {pur.currency} · {pur.createdAt?.slice(0, 10)}</p>
                    {pur.licenseKey && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-[11px] text-foreground">{pur.licenseKey}</span>
                        <button onClick={() => copyToClipboard(pur.licenseKey!)} className="text-muted-foreground hover:text-foreground"><Copy className="w-3 h-3" /></button>
                      </div>
                    )}
                  </div>
                  {pur.status === "pending" && !pur.licenseKey && (
                    <span className="text-[10px] font-body text-amber-400 shrink-0">Manual review required</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Webhooks ── */}
      {activeSection === "webhooks" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base text-foreground">Discord Webhooks</h3>
            <button onClick={() => { setWebhooks(null); }} className="text-xs font-body text-muted-foreground hover:text-foreground flex items-center gap-1">
              <RefreshCcw className="w-3 h-3" /> Refresh
            </button>
          </div>
          <p className="text-xs font-body text-muted-foreground">All Discord webhook configurations across every tenant and the global admin account.</p>
          {webhooksLoading ? (
            <div className="py-8 text-center text-muted-foreground font-body text-sm animate-pulse">Loading webhooks…</div>
          ) : webhooks && webhooks.length > 0 ? (
            <div className="space-y-3">
              {webhooks.map(wh => (
                <div key={wh.tenantSlug} className="glass-panel rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${wh.discordWebhookUrl ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                      <span className="font-body text-sm text-foreground font-medium">{wh.displayName}</span>
                      {wh.tenantSlug === "__admin__" && (
                        <span className="text-[9px] font-body bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Global</span>
                      )}
                      {wh.tenantSlug !== "__admin__" && (
                        <span className="text-[9px] font-mono text-muted-foreground">/{wh.tenantSlug}</span>
                      )}
                    </div>
                    <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${wh.discordWebhookUrl ? "bg-green-500/10 text-green-400" : "bg-secondary text-muted-foreground"}`}>
                      {wh.discordWebhookUrl ? "Configured" : "Not set"}
                    </span>
                  </div>
                  {wh.discordWebhookUrl && (
                    <>
                      <p className="text-xs font-mono text-muted-foreground truncate pl-4">{wh.discordWebhookUrl.replace(/\/[^/]+\/[^/]+$/, "/***")}</p>
                      <div className="flex flex-wrap gap-2 pl-4">
                        {[
                          { key: "discordNotifyBookings", label: "Bookings" },
                          { key: "discordNotifyDownloads", label: "Downloads" },
                          { key: "discordNotifyProofing", label: "Proofing" },
                          { key: "discordNotifyInvoices", label: "Invoices" },
                        ].map(({ key, label }) => (
                          <span key={key} className={`text-[10px] font-body px-2 py-0.5 rounded-full border ${(wh as Record<string, unknown>)[key] ? "border-primary/30 text-primary bg-primary/5" : "border-border text-muted-foreground/50 line-through"}`}>
                            {label}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p className="font-body text-sm">No webhook configurations found.</p>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

