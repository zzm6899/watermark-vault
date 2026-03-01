import { useState } from "react";
import { Camera, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getAdminCredentials, hashPassword, login } from "@/lib/storage";
import { syncFromServer } from "@/lib/api";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      // Sync from server first — ensures credentials are in localStorage
      // after a container restart where localStorage is empty
      await syncFromServer();

      const creds = getAdminCredentials();
      if (!creds) {
        toast.error("No admin account set up. Please run setup first.");
        return;
      }
      const hash = await hashPassword(password);
      if (creds.username !== username || creds.passwordHash !== hash) {
        toast.error("Invalid username or password");
        return;
      }
      login();
      onLogin();
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
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" className="bg-secondary border-border text-foreground font-body" onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" className="bg-secondary border-border text-foreground font-body" onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
          </div>
          <Button onClick={handleLogin} disabled={loading} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
            <LogIn className="w-4 h-4" /> {loading ? "Signing in..." : "Sign In"}
          </Button>
        </div>
      </div>
    </div>
  );
}
