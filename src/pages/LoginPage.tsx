import { useState, useEffect } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { Camera, LogIn, RadioTower, Wifi, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getAdminCredentials, getAdminSessionHash, hashPassword, login, logout, setAdminSessionHash, setMobileTenantSession, getMobileTenantSession, isLoggedIn } from "@/lib/storage";
import { syncFromServer, tenantLogin, verifyAdminCredentials, recheckServer } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

export default function LoginPage({ onLogin }: { onLogin?: () => void } = {}) {
  const navigate = useNavigate();
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
      if (isNative && !getAdminSessionHash()) {
        logout();
        return;
      }
      navigate(isNative ? "/capture" : "/admin", { replace: true });
    }
  }, [navigate, isNative]);

  const handleLogin = async () => {
    if (!identifier.trim()) {
      toast.error("Please enter your username or account ID");
      return;
    }
    setLoading(true);
    try {
      const hash = await hashPassword(password);
      const normalized = identifier.trim().toLowerCase();
      const serverOk = await recheckServer();

      // Try admin credentials first
      const adminOk = serverOk
        ? await verifyAdminCredentials(normalized, hash)
        : (() => { const creds = getAdminCredentials(); return !!(creds && creds.username === normalized && creds.passwordHash === hash); })();
      if (adminOk) {
        // Store the SHA-256 hash before sync so protected financial/contact
        // stores are included in the post-login fetch.
        // adminAuthHeaders() uses it to
        // build correct Basic Auth credentials for protected API endpoints.
        setAdminSessionHash(hash);
        if (serverOk) await syncFromServer({ awaitLazy: true }).catch(() => false);
        login();
        onLogin?.();
        navigate(isNative ? "/capture" : "/admin", { replace: true });
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
    <div className="capture-app-shell min-h-screen flex items-center justify-center p-4" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-400/10 text-cyan-100">
            <RadioTower className="h-7 w-7" />
          </div>
          <p className="text-[11px] font-body uppercase tracking-[0.22em] text-cyan-100/55">Zuploader Capture</p>
          <h1 className="mt-2 text-4xl font-body font-semibold tracking-normal text-white">Camera intake</h1>
          <p className="mt-3 text-sm font-body leading-6 text-white/52">Sign in to receive Nikon photos over Wi-Fi, cull them, and publish the client-ready set.</p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="capture-mini-metric"><Wifi className="mx-auto mb-1 h-4 w-4 text-cyan-100" /><small>FTP</small></div>
            <div className="capture-mini-metric"><ImageIcon className="mx-auto mb-1 h-4 w-4 text-cyan-100" /><small>Cull</small></div>
            <div className="capture-mini-metric"><Camera className="mx-auto mb-1 h-4 w-4 text-cyan-100" /><small>Client</small></div>
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div>
            <label htmlFor="login-identifier" className="text-xs font-body tracking-wider uppercase text-white/45 mb-1.5 block">Username or Account ID</label>
            <Input
              id="login-identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="studio username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              className="h-12 rounded-xl border-white/10 bg-white/[0.06] text-white placeholder:text-white/30 font-body"
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="text-xs font-body tracking-wider uppercase text-white/45 mb-1.5 block">Password</label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              autoComplete="current-password"
              className="h-12 rounded-xl border-white/10 bg-white/[0.06] text-white placeholder:text-white/30 font-body"
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>
          <Button onClick={handleLogin} disabled={loading} className="h-12 w-full rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200 font-body text-xs tracking-wider uppercase gap-2">
            <LogIn className="w-4 h-4" /> {loading ? "Signing in..." : "Sign In"}
          </Button>
        </div>
      </div>
    </div>
  );
}
