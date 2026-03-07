import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Key, Globe, CheckCircle2, ArrowRight, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { getTenantSetupInfo, completeTenantSetup } from "@/lib/api";
import { hashPassword } from "@/lib/storage";
import type { LicenseKey } from "@/lib/types";

type Step = "loading" | "error" | "form" | "done";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$|^[a-z0-9]{1,2}$/;

function slugify(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export default function TenantSetup() {
  const { token } = useParams<{ token: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // License key info from server
  const [keyInfo, setKeyInfo] = useState<Pick<LicenseKey, "key" | "issuedTo" | "isTrial" | "trialMaxEvents" | "trialMaxBookings" | "expiresAt"> | null>(null);

  // Form fields
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Done state
  const [bookingUrl, setBookingUrl] = useState("");
  const [adminUrl, setAdminUrl] = useState("");
  const [createdSlug, setCreatedSlug] = useState("");

  // Load setup info on mount
  useEffect(() => {
    if (!token) {
      setErrorMsg("No setup token provided.");
      setStep("error");
      return;
    }
    getTenantSetupInfo(token).then((info) => {
      if (info.error || !info.key) {
        setErrorMsg(info.error || "Invalid or expired setup link.");
        setStep("error");
        return;
      }
      setKeyInfo({
        key: info.key,
        issuedTo: info.issuedTo || "",
        isTrial: info.isTrial,
        trialMaxEvents: info.trialMaxEvents,
        trialMaxBookings: info.trialMaxBookings,
        expiresAt: info.expiresAt,
      });
      setStep("form");
    });
  }, [token]);

  // Auto-generate slug from display name
  useEffect(() => {
    if (!slugEdited && displayName) {
      setSlug(slugify(displayName));
    }
  }, [displayName, slugEdited]);

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      toast.error("Display name is required");
      return;
    }
    if (!slug || !SLUG_RE.test(slug)) {
      toast.error("URL slug must be 1–30 lowercase letters, numbers, or hyphens");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("A valid email address is required");
      return;
    }
    if (!password) {
      toast.error("A password is required to log in to your account");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setSubmitting(true);
    const passwordHash = await hashPassword(password);
    const result = await completeTenantSetup(token!, {
      slug,
      displayName: displayName.trim(),
      email: email.trim(),
      bio: bio.trim() || undefined,
      passwordHash,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error || "Setup failed. Please try again.");
      return;
    }
    const url = `${window.location.origin}/book/${slug}`;
    setBookingUrl(url);
    setAdminUrl(`${window.location.origin}/tenant-admin/${slug}`);
    setCreatedSlug(slug);
    setStep("done");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <AnimatePresence mode="wait">
        {step === "loading" && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-3 text-muted-foreground"
          >
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="font-body text-sm">Verifying your setup link…</p>
          </motion.div>
        )}

        {step === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass-panel rounded-2xl p-8 max-w-md w-full text-center space-y-4"
          >
            <Camera className="w-10 h-10 text-muted-foreground mx-auto" />
            <h1 className="font-display text-xl text-foreground">Setup Link Invalid</h1>
            <p className="font-body text-sm text-muted-foreground">{errorMsg}</p>
            <p className="font-body text-xs text-muted-foreground">
              Please contact the platform administrator for a new setup link.
            </p>
          </motion.div>
        )}

        {step === "form" && keyInfo && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass-panel rounded-2xl p-8 max-w-lg w-full space-y-6"
          >
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Camera className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="font-display text-xl text-foreground">Welcome to Watermark Vault</h1>
                <p className="font-body text-xs text-muted-foreground">Set up your photographer account</p>
              </div>
            </div>

            {/* License key info */}
            <div className="p-3 rounded-lg bg-secondary/50 border border-border/50 flex items-start gap-2">
              <Key className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-body text-foreground">
                  License key: <span className="font-mono tracking-widest">{keyInfo.key}</span>
                </p>
                <p className="text-[11px] font-body text-muted-foreground mt-0.5">
                  Issued to: {keyInfo.issuedTo}
                  {keyInfo.isTrial && (
                    <span className="ml-2 bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded-full text-[10px]">
                      Free Trial · {keyInfo.trialMaxEvents ?? 1} event{(keyInfo.trialMaxEvents ?? 1) !== 1 ? "s" : ""} · {keyInfo.trialMaxBookings ?? 10} bookings
                    </span>
                  )}
                  {keyInfo.expiresAt && (
                    <span className="ml-2 text-muted-foreground">
                      · Expires {keyInfo.expiresAt.slice(0, 10)}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Display Name *</label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Jane Smith Photography"
                  className="bg-background border-border text-foreground font-body text-sm"
                  autoFocus
                />
                <p className="text-[10px] font-body text-muted-foreground mt-0.5">
                  This appears on your public booking page
                </p>
              </div>

              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">
                  Your URL Slug *
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-body text-muted-foreground shrink-0">/book/</span>
                  <Input
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                      setSlugEdited(true);
                    }}
                    placeholder="your-slug"
                    className="bg-background border-border text-foreground font-body text-sm font-mono"
                  />
                </div>
                <p className="text-[10px] font-body text-muted-foreground mt-0.5">
                  Your booking page will be at:{" "}
                  <span className="text-primary">{window.location.origin}/book/{slug || "your-slug"}</span>
                </p>
              </div>

              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Email *</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="bg-background border-border text-foreground font-body text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">
                  Bio <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A short description shown on your booking page…"
                  className="bg-background border-border text-foreground font-body text-sm resize-none"
                  rows={3}
                />
              </div>

              <div className="border-t border-border/50 pt-4 space-y-3">
                <p className="text-xs font-body text-muted-foreground font-medium">Set your login password</p>
                <div>
                  <label className="text-xs font-body text-muted-foreground mb-1 block">Password *</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="bg-background border-border text-foreground font-body text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-body text-muted-foreground mb-1 block">Confirm Password *</label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="bg-background border-border text-foreground font-body text-sm"
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  />
                </div>
                <p className="text-[10px] font-body text-muted-foreground">
                  You'll use your Account ID (<span className="text-primary font-mono">{slug || "your-slug"}</span>) and this password to log in.
                </p>
              </div>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Setting up…
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4" /> Complete Setup <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </motion.div>
        )}

        {step === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="glass-panel rounded-2xl p-8 max-w-md w-full text-center space-y-5"
          >
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
            </div>
            <div>
              <h1 className="font-display text-xl text-foreground">You're all set!</h1>
              <p className="font-body text-sm text-muted-foreground mt-1">
                Your Watermark Vault account has been created successfully.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-secondary/50 border border-border/50 text-left space-y-2">
              <div>
                <p className="text-xs font-body text-muted-foreground">Your public booking page:</p>
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-body text-primary break-all hover:underline"
                >
                  {bookingUrl}
                </a>
              </div>
              <div>
                <p className="text-xs font-body text-muted-foreground">Your admin dashboard:</p>
                <a
                  href={adminUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-body text-primary break-all hover:underline"
                >
                  {adminUrl}
                </a>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-left space-y-1">
              <p className="text-xs font-body text-foreground font-medium">Your login details:</p>
              <p className="text-xs font-body text-muted-foreground">
                Account ID: <span className="text-primary font-mono">{createdSlug}</span>
              </p>
              <p className="text-xs font-body text-muted-foreground">
                Password: the one you just set
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 font-body text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(bookingUrl)
                    .then(() => toast.success("Booking URL copied!"))
                    .catch(() => toast.error("Copy failed"));
                }}
              >
                Copy Booking URL
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-primary text-primary-foreground font-body text-xs gap-1"
                onClick={() => window.location.href = `/login`}
              >
                <LogIn className="w-3.5 h-3.5" /> Sign In
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type Step = "loading" | "error" | "form" | "done";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$|^[a-z0-9]{1,2}$/;

function slugify(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export default function TenantSetup() {
  const { token } = useParams<{ token: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // License key info from server
  const [keyInfo, setKeyInfo] = useState<Pick<LicenseKey, "key" | "issuedTo" | "isTrial" | "trialMaxEvents" | "trialMaxBookings" | "expiresAt"> | null>(null);

  // Form fields
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Done state
  const [bookingUrl, setBookingUrl] = useState("");

  // Load setup info on mount
  useEffect(() => {
    if (!token) {
      setErrorMsg("No setup token provided.");
      setStep("error");
      return;
    }
    getTenantSetupInfo(token).then((info) => {
      if (info.error || !info.key) {
        setErrorMsg(info.error || "Invalid or expired setup link.");
        setStep("error");
        return;
      }
      setKeyInfo({
        key: info.key,
        issuedTo: info.issuedTo || "",
        isTrial: info.isTrial,
        trialMaxEvents: info.trialMaxEvents,
        trialMaxBookings: info.trialMaxBookings,
        expiresAt: info.expiresAt,
      });
      setStep("form");
    });
  }, [token]);

  // Auto-generate slug from display name
  useEffect(() => {
    if (!slugEdited && displayName) {
      setSlug(slugify(displayName));
    }
  }, [displayName, slugEdited]);

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      toast.error("Display name is required");
      return;
    }
    if (!slug || !SLUG_RE.test(slug)) {
      toast.error("URL slug must be 1–30 lowercase letters, numbers, or hyphens");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("A valid email address is required");
      return;
    }
    setSubmitting(true);
    const result = await completeTenantSetup(token!, {
      slug,
      displayName: displayName.trim(),
      email: email.trim(),
      bio: bio.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error || "Setup failed. Please try again.");
      return;
    }
    const url = `${window.location.origin}/book/${slug}`;
    setBookingUrl(url);
    setStep("done");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <AnimatePresence mode="wait">
        {step === "loading" && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-3 text-muted-foreground"
          >
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="font-body text-sm">Verifying your setup link…</p>
          </motion.div>
        )}

        {step === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass-panel rounded-2xl p-8 max-w-md w-full text-center space-y-4"
          >
            <Camera className="w-10 h-10 text-muted-foreground mx-auto" />
            <h1 className="font-display text-xl text-foreground">Setup Link Invalid</h1>
            <p className="font-body text-sm text-muted-foreground">{errorMsg}</p>
            <p className="font-body text-xs text-muted-foreground">
              Please contact the platform administrator for a new setup link.
            </p>
          </motion.div>
        )}

        {step === "form" && keyInfo && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass-panel rounded-2xl p-8 max-w-lg w-full space-y-6"
          >
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Camera className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="font-display text-xl text-foreground">Welcome to Watermark Vault</h1>
                <p className="font-body text-xs text-muted-foreground">Set up your photographer account</p>
              </div>
            </div>

            {/* License key info */}
            <div className="p-3 rounded-lg bg-secondary/50 border border-border/50 flex items-start gap-2">
              <Key className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-body text-foreground">
                  License key: <span className="font-mono tracking-widest">{keyInfo.key}</span>
                </p>
                <p className="text-[11px] font-body text-muted-foreground mt-0.5">
                  Issued to: {keyInfo.issuedTo}
                  {keyInfo.isTrial && (
                    <span className="ml-2 bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded-full text-[10px]">
                      Free Trial · {keyInfo.trialMaxEvents ?? 1} event{(keyInfo.trialMaxEvents ?? 1) !== 1 ? "s" : ""} · {keyInfo.trialMaxBookings ?? 10} bookings
                    </span>
                  )}
                  {keyInfo.expiresAt && (
                    <span className="ml-2 text-muted-foreground">
                      · Expires {keyInfo.expiresAt.slice(0, 10)}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Display Name *</label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Jane Smith Photography"
                  className="bg-background border-border text-foreground font-body text-sm"
                  autoFocus
                />
                <p className="text-[10px] font-body text-muted-foreground mt-0.5">
                  This appears on your public booking page
                </p>
              </div>

              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">
                  Your URL Slug *
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-body text-muted-foreground shrink-0">/book/</span>
                  <Input
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                      setSlugEdited(true);
                    }}
                    placeholder="your-slug"
                    className="bg-background border-border text-foreground font-body text-sm font-mono"
                  />
                </div>
                <p className="text-[10px] font-body text-muted-foreground mt-0.5">
                  Your booking page will be at:{" "}
                  <span className="text-primary">{window.location.origin}/book/{slug || "your-slug"}</span>
                </p>
              </div>

              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">Email *</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="bg-background border-border text-foreground font-body text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-body text-muted-foreground mb-1 block">
                  Bio <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A short description shown on your booking page…"
                  className="bg-background border-border text-foreground font-body text-sm resize-none"
                  rows={3}
                />
              </div>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Setting up…
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4" /> Complete Setup <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </motion.div>
        )}

        {step === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="glass-panel rounded-2xl p-8 max-w-md w-full text-center space-y-5"
          >
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
            </div>
            <div>
              <h1 className="font-display text-xl text-foreground">You're all set!</h1>
              <p className="font-body text-sm text-muted-foreground mt-1">
                Your Watermark Vault account has been created successfully.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-secondary/50 border border-border/50 text-left space-y-1">
              <p className="text-xs font-body text-muted-foreground">Your public booking page:</p>
              <a
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-body text-primary break-all hover:underline"
              >
                {bookingUrl}
              </a>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 font-body text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(bookingUrl)
                    .then(() => toast.success("URL copied!"))
                    .catch(() => toast.error("Copy failed"));
                }}
              >
                Copy URL
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-primary text-primary-foreground font-body text-xs"
                onClick={() => window.open(bookingUrl, "_blank")}
              >
                Visit Your Page
              </Button>
            </div>

            <p className="text-[11px] font-body text-muted-foreground">
              Contact your platform administrator to configure payments, email notifications, and other settings for your account.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
