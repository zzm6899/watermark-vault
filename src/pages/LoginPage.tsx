import { useState, useEffect } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { Camera, LogIn, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getAdminCredentials, hashPassword, login, setMobileTenantSession, getMobileTenantSession, isLoggedIn } from "@/lib/storage";
import { syncFromServer, tenantLogin, verifyAdminCredentials, isServerMode } from "@/lib/api";
import { useNavigate } from "react-router-dom";

export default function LoginPage({ onLogin }: { onLogin?: () => void } = {}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"tenant" | "admin">("tenant");

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

  // Admin fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Tenant fields
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantPassword, setTenantPassword] = useState("");

  const [loading, setLoading] = useState(false);

  const handleAdminLogin = async () => {
    setLoading(true);
    try {
      await syncFromServer();
      const hash = await hashPassword(password);
      const normalizedUsername = username.trim().toLowerCase();
      // Verify server-side in server mode (bcrypt-aware), locally in localStorage mode
      const ok = isServerMode()
        ? await verifyAdminCredentials(normalizedUsername, hash)
        : (() => { const creds = getAdminCredentials(); return !!(creds && creds.username === normalizedUsername && creds.passwordHash === hash); })();
      if (!ok) {
        toast.error("Invalid username or password");
        return;
      }
      login();
      onLogin?.();
      navigate("/admin", { replace: true });
    } finally {
      setLoading(false);
    }
  };

  const handleTenantLogin = async () => {
    if (!tenantSlug.trim()) {
      toast.error("Please enter your Account ID");
      return;
    }
    setLoading(true);
    try {
      const hash = await hashPassword(tenantPassword);
      const result = await tenantLogin(tenantSlug.trim().toLowerCase(), hash);
      if (!result.ok) {
        toast.error(result.error || "Invalid credentials");
        return;
      }
      setMobileTenantSession({
        slug: result.tenant!.slug,
        displayName: result.tenant!.displayName,
        email: result.tenant!.email,
        timezone: result.tenant!.timezone,
        loggedAt: new Date().toISOString(),
      });
      navigate(`/tenant-admin/${result.tenant!.slug}`, { replace: true });
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

        {/* Mode toggle */}
        <div className="flex gap-1 mb-4 bg-secondary rounded-xl p-1">
          <button
            onClick={() => setMode("tenant")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-body tracking-wider uppercase transition-all ${mode === "tenant" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Users className="w-3.5 h-3.5" />
            Photographer
          </button>
          <button
            onClick={() => setMode("admin")}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-body tracking-wider uppercase transition-all ${mode === "admin" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Admin
          </button>
        </div>

        <div className="glass-panel rounded-xl p-6 space-y-4">
          {mode === "admin" ? (
            <>
              <div>
                <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Username</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  className="bg-secondary border-border text-foreground font-body"
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                />
              </div>
              <div>
                <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete="current-password"
                  className="bg-secondary border-border text-foreground font-body"
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                />
              </div>
              <Button onClick={handleAdminLogin} disabled={loading} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                <LogIn className="w-4 h-4" /> {loading ? "Signing in..." : "Sign In"}
              </Button>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Account ID</label>
                <Input
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  placeholder="your-account-id"
                  autoComplete="username"
                  className="bg-secondary border-border text-foreground font-body"
                  autoCapitalize="none"
                  autoCorrect="off"
                  onKeyDown={(e) => e.key === "Enter" && handleTenantLogin()}
                />
              </div>
              <div>
                <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Password</label>
                <Input
                  type="password"
                  value={tenantPassword}
                  onChange={(e) => setTenantPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete="current-password"
                  className="bg-secondary border-border text-foreground font-body"
                  onKeyDown={(e) => e.key === "Enter" && handleTenantLogin()}
                />
              </div>
              <Button onClick={handleTenantLogin} disabled={loading} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                <LogIn className="w-4 h-4" /> {loading ? "Signing in..." : "Sign In"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
