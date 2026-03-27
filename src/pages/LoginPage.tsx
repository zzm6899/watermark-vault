import { useState, useEffect } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { Camera, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getAdminCredentials, hashPassword, login, setMobileTenantSession, getMobileTenantSession, isLoggedIn } from "@/lib/storage";
import { syncFromServer, tenantLogin, verifyAdminCredentials, isServerMode } from "@/lib/api";
import { useNavigate } from "react-router-dom";

export default function LoginPage({ onLogin }: { onLogin?: () => void } = {}) {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  usePageTitle("Login");

  // If already authenticated, redirect immediately
  useEffect(() => {
    const tenantSession = getMobileTenantSession();
    if (tenantSession) {
      navigate(`/tenant-admin/${tenantSession.slug}`, { replace: true });
      return;
    }
    if (isLoggedIn()) {
      navigate("/admin", { replace: true });
    }
  }, [navigate]);

  const handleLogin = async () => {
    if (!identifier.trim()) {
      toast.error("Please enter your username or account ID");
      return;
    }
    setLoading(true);
    try {
      await syncFromServer();
      const hash = await hashPassword(password);
      const normalized = identifier.trim().toLowerCase();

      // Try admin credentials first
      const adminOk = isServerMode()
        ? await verifyAdminCredentials(normalized, hash)
        : (() => { const creds = getAdminCredentials(); return !!(creds && creds.username === normalized && creds.passwordHash === hash); })();
      if (adminOk) {
        login();
        onLogin?.();
        navigate("/admin", { replace: true });
        return;
      }

      // Fall back to tenant / photographer login
      const result = await tenantLogin(normalized, hash);
      if (result.ok && result.tenant) {
        setMobileTenantSession({
          slug: result.tenant.slug,
          displayName: result.tenant.displayName,
          email: result.tenant.email,
          timezone: result.tenant.timezone,
          loggedAt: new Date().toISOString(),
        });
        navigate(`/tenant-admin/${result.tenant.slug}`, { replace: true });
        return;
      }

      toast.error("Invalid username or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Camera className="w-10 h-10 text-primary mx-auto mb-4" />
          <h1 className="font-display text-2xl text-foreground">Sign In</h1>
          <p className="text-sm font-body text-muted-foreground mt-1">Access your PhotoFlow account.</p>
        </div>
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <div>
            <label htmlFor="login-identifier" className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Username or Account ID</label>
            <Input
              id="login-identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="admin or your-account-id"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              className="bg-secondary border-border text-foreground font-body"
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Password</label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              autoComplete="current-password"
              className="bg-secondary border-border text-foreground font-body"
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>
          <Button onClick={handleLogin} disabled={loading} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
            <LogIn className="w-4 h-4" /> {loading ? "Signing in..." : "Sign In"}
          </Button>
        </div>
      </div>
    </div>
  );
}
