import { useState } from "react";
import { Camera, Mail, ArrowRight, Star, Sparkles, Clock, Image, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function ClientPortal() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleRequest = async () => {
    if (!email.includes("@")) { toast.error("Please enter a valid email address"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/client-portal/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setSubmitted(true);
    } catch (err: any) {
      toast.error(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/40 px-6 py-4 flex items-center gap-3">
        <Camera className="w-5 h-5 text-primary" />
        <span className="font-display text-sm text-foreground">Your Gallery</span>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {!submitted ? (
            <>
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Image className="w-7 h-7 text-primary" />
                </div>
                <h1 className="font-display text-2xl text-foreground mb-2">Access Your Photos</h1>
                <p className="text-sm font-body text-muted-foreground">
                  Enter the email you used when booking and we'll send you links to all your galleries.
                </p>
              </div>

              <div className="glass-panel rounded-xl p-6 space-y-4">
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">
                    Your Email
                  </label>
                  <Input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleRequest()}
                    placeholder="you@example.com"
                    className="bg-secondary border-border text-foreground font-body"
                    autoFocus
                  />
                </div>
                <Button
                  onClick={handleRequest}
                  disabled={loading || !email}
                  className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2"
                >
                  <Mail className="w-4 h-4" />
                  {loading ? "Sending…" : "Send My Gallery Links"}
                  {!loading && <ArrowRight className="w-3.5 h-3.5" />}
                </Button>
              </div>

              {/* What to expect */}
              <div className="mt-6 space-y-3">
                {[
                  { icon: Star, label: "Proof your photos", desc: "Star your favourites for editing" },
                  { icon: Sparkles, label: "Download finals", desc: "Access your edited photos" },
                  { icon: Clock, label: "Track your booking", desc: "See session status and details" },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-body text-foreground font-medium">{label}</p>
                      <p className="text-xs font-body text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <Mail className="w-7 h-7 text-green-400" />
              </div>
              <h2 className="font-display text-xl text-foreground mb-3">Check your inbox</h2>
              <p className="text-sm font-body text-muted-foreground mb-2">
                If we have any galleries for <span className="text-foreground">{email}</span>, you'll receive an email with your personal links shortly.
              </p>
              <p className="text-xs font-body text-muted-foreground/60 mb-6">
                The email comes from your photographer. Check your spam folder if you don't see it.
              </p>
              <button
                onClick={() => { setSubmitted(false); setEmail(""); }}
                className="text-xs font-body text-muted-foreground hover:text-foreground underline"
              >
                Try a different email
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
