import { useState, useEffect } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { Camera, LogIn, RadioTower, Wifi, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { clearAdminClientCredentials, hashPassword, login, logout, setMobileTenantSession, getMobileTenantSession, isLoggedIn } from "@/lib/storage";
import { getAdminApiToken, syncFromServer, tenantLogin, verifyAdminCredentials, recheckServer } from "@/lib/api";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

export default function LoginPage({ onLogin }: { onLogin?: () => void } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const adminDestination = location.pathname.startsWith("/admin") ? `${location.pathname}${location.search}` : "/admin";
  const isNative = Capacitor.isNativePlatform();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  usePageTitle("Login");

  // If already authenticated, redirect immediately
  useEffect(() => {
    const tenantSession = getMobileTenantSession();
    if (tenantSession) {
      navigate(isNative ? "/capture" : `/tenant-admin/${tenantSession.slug}`, { replace: true });
      return;
    }
    if (isLoggedIn()) {
      if (isNative && !getAdminApiToken()) {
        logout();
        return;
      }
      navigate(isNative ? "/capture" : adminDestination, { replace: true });
    }
  }, [navigate, isNative, adminDestination]);

  const handleLogin = async () => {
    if (loading) return;
    if (!identifier.trim()) {
      toast.error("Enter your username, email or account ID");
      return;
    }
    setLoading(true);
    try {
      const hash = await hashPassword(password);
      const normalized = identifier.trim().toLowerCase();
      const serverOk = await recheckServer();

      // Try admin credentials first
      const adminOk = serverOk && await verifyAdminCredentials(normalized, hash);
      if (adminOk) {
        if (!isNative) {
          // Browser requests use the HttpOnly cookie set by /api/auth/verify.
          clearAdminClientCredentials();
        }
        if (serverOk) await syncFromServer({ awaitLazy: true }).catch(() => false);
        login();
        onLogin?.();
        navigate(isNative ? "/capture" : adminDestination, { replace: true });
        return;
      }

      // Fall back to tenant / photographer login
      if (!serverOk) {
        toast.error("Cannot reach the photo server. Check internet, then try again.");
        return;
      }
      const result = await tenantLogin(normalized, hash);
      if (result.ok && result.tenant) {
        setMobileTenantSession({
          slug: result.tenant.slug,
          displayName: result.tenant.displayName,
          email: result.tenant.email,
          timezone: result.tenant.timezone,
          loggedAt: new Date().toISOString(),
        });
        navigate(isNative ? "/capture" : `/tenant-admin/${result.tenant.slug}`, { replace: true });
        return;
      }

      toast.error(result.error || "Invalid username or password");
    } catch (err: any) {
      console.error("Login error:", err);
      toast.error(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell relative flex min-h-screen items-center justify-center overflow-hidden p-4" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="pointer-events-none absolute -left-28 top-1/4 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-cyan-400/[0.06] blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-lg shadow-primary/5">
            {isNative ? <RadioTower className="h-7 w-7" /> : <Camera className="h-7 w-7" />}
          </div>
          <p className="text-[10px] font-body font-semibold uppercase tracking-[0.28em] text-primary/80">{isNative ? "Zuploader Capture" : "Zac M Photos · Studio"}</p>
          <h1 className="mt-2 text-4xl font-display font-semibold tracking-wide text-foreground">{isNative ? "Photo upload" : "Welcome back"}</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm font-body leading-6 text-muted-foreground">{isNative ? "Send photos from your camera, review them, and share galleries with clients." : "Your bookings, galleries and studio finances, all in one place."}</p>
          {isNative && <div className="mx-auto mt-5 grid max-w-xs grid-cols-3 gap-2">
            <div className="capture-mini-metric"><Wifi className="mx-auto mb-1 h-4 w-4 text-primary" /><small>Upload</small></div>
            <div className="capture-mini-metric"><ImageIcon className="mx-auto mb-1 h-4 w-4 text-primary" /><small>Review</small></div>
            <div className="capture-mini-metric"><Camera className="mx-auto mb-1 h-4 w-4 text-primary" /><small>Share</small></div>
          </div>}
        </div>
        <div className="glass-panel rounded-2xl p-6 shadow-2xl shadow-black/30 sm:p-7">
          <div className="mb-5 border-b border-border/70 pb-4">
            <h2 className="font-display text-lg font-semibold text-foreground">Sign in to your account</h2>
            <p className="mt-1 text-xs font-body text-muted-foreground">Enter your studio username and password to continue.</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void handleLogin(); }} className="space-y-4">
          <div>
            <label htmlFor="login-identifier" className="text-xs font-body tracking-wide text-muted-foreground mb-1.5 block">Username, email or account ID</label>
            <Input
              id="login-identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Username, email or account ID"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              className="soft-input h-12 rounded-xl text-foreground placeholder:text-muted-foreground/60 font-body focus-visible:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="text-xs font-body tracking-wide text-muted-foreground mb-1.5 block">Password</label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              autoComplete="current-password"
              className="soft-input h-12 rounded-xl text-foreground placeholder:text-muted-foreground/60 font-body focus-visible:ring-primary"
            />
          </div>
          <Button type="submit" disabled={loading} className="h-12 w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs font-semibold tracking-wider uppercase gap-2 shadow-lg shadow-primary/10">
            <LogIn className="w-4 h-4" /> {loading ? "Signing in..." : "Sign In to Studio"}
          </Button>
          </form>
        </div>
        <p className="mt-5 text-center text-[10px] font-body tracking-wide text-muted-foreground/55">SECURE STUDIO ACCESS</p>
      </div>
    </div>
  );
}
