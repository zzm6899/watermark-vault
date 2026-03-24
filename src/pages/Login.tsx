import { useState } from "react";
import { Camera, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getAdminCredentials, hashPassword, login, setMobileTenantSession } from "@/lib/storage";
import { syncFromServer, tenantLogin, verifyAdminCredentials, isServerMode } from "@/lib/api";
import { useNavigate } from "react-router-dom";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      // Sync from server first — ensures credentials are in localStorage
      // after a container restart where localStorage is empty
      await syncFromServer();

      const hash = await hashPassword(password);
      const normalizedUsername = username.trim().toLowerCase();

      // Try admin credentials first
      // In server mode: verify server-side so bcrypt hashes are handled correctly
      // In localStorage mode: compare directly (sha256 === sha256)
      const adminOk = isServerMode()
        ? await verifyAdminCredentials(normalizedUsername, hash)
        : (() => { const creds = getAdminCredentials(); return !!(creds && creds.username === normalizedUsername && creds.passwordHash === hash); })();
      if (adminOk) {
        login();
        onLogin();
        return;
      }

      // Try tenant credentials (username = tenant slug)
      const result = await tenantLogin(normalizedUsername, hash);
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
          <h1 className="font-display text-2xl text-foreground">Admin Login</h1>
          <p className="text-sm font-body text-muted-foreground mt-1">Sign in to manage your bookings.</p>
        </div>
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Username</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoComplete="username" className="bg-secondary border-border text-foreground font-body" onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" autoComplete="current-password" className="bg-secondary border-border text-foreground font-body" onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
          </div>
          <Button onClick={handleLogin} disabled={loading} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
            <LogIn className="w-4 h-4" /> {loading ? "Signing in..." : "Sign In"}
          </Button>
        </div>
      </div>
    </div>
  );
}
