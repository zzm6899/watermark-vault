/**
 * ContractSign — public page for clients to review and e-sign a booking contract.
 * Accessed via /sign/:token — no login required.
 */
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FileText, CheckCircle2, PenLine, AlertCircle, Loader2,
  ShieldCheck, Clock, User, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getContractByToken, signContract } from "@/lib/api";
import Footer from "@/components/Footer";

type ContractInfo = {
  id: string;
  title: string;
  status: "pending" | "signed" | "declined";
  bookingId?: string;
  pdfPath?: string;
};

function formatDate(isoStr: string) {
  try {
    return new Date(isoStr).toLocaleString("en-AU", {
      day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return isoStr;
  }
}

export default function ContractSign() {
  const { token } = useParams<{ token: string }>();
  const [contract, setContract] = useState<ContractInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError("Invalid link."); setLoading(false); return; }
    getContractByToken(token)
      .then((c) => {
        if (!c) { setError("Contract not found. This link may be invalid or expired."); return; }
        setContract(c as ContractInfo);
      })
      .catch(() => setError("Failed to load contract."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSign() {
    if (!token || !contract) return;
    if (!fullName.trim()) { toast.error("Please enter your full legal name."); return; }
    if (!agreed) { toast.error("Please confirm you have read and agree to the contract."); return; }
    setSigning(true);
    try {
      const result = await signContract(token, fullName.trim());
      if (!result?.ok) { toast.error("Signing failed. Please try again."); return; }
      setSignedAt(result.signedAt);
      setContract((prev) => prev ? { ...prev, status: "signed" } : prev);
      toast.success("Contract signed successfully!");
    } catch {
      toast.error("Request failed. Please try again.");
    } finally {
      setSigning(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="text-white text-lg font-semibold">Contract Not Found</p>
        <p className="text-zinc-400 text-sm max-w-sm">{error || "This link may be invalid or expired."}</p>
      </div>
    );
  }

  const alreadySigned = contract.status === "signed";
  const pdfUrl = contract.pdfPath ? `/api/uploads/${contract.pdfPath}` : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center">
            <FileText className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-zinc-200">{contract.title || "Contract"}</span>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${alreadySigned ? "bg-green-500/20 text-green-300 border border-green-500/30" : "bg-amber-500/20 text-amber-300 border border-amber-500/30"}`}>
          {alreadySigned ? "Signed" : "Awaiting Signature"}
        </span>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        {/* Already signed banner */}
        {(alreadySigned || signedAt) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-xl p-5"
          >
            <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0" />
            <div>
              <p className="text-green-300 font-semibold">Contract Signed</p>
              {signedAt && <p className="text-green-300/70 text-xs mt-0.5">Signed on {formatDate(signedAt)}</p>}
              <p className="text-green-300/60 text-xs mt-1">A copy of this signed contract has been recorded. The photographer has been notified.</p>
            </div>
          </motion.div>
        )}

        {/* Contract title + info */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center shrink-0 mt-0.5">
              <FileText className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">{contract.title}</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Please read the full contract below before signing.</p>
            </div>
          </div>

          {/* PDF embed */}
          {pdfUrl ? (
            <div className="mt-2">
              <iframe
                src={pdfUrl}
                title="Contract PDF"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800"
                style={{ height: "480px" }}
              />
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors"
              >
                <FileText className="w-3 h-3" />
                Open PDF in new tab
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-zinc-400 text-sm bg-zinc-800/50 rounded-lg p-3">
              <FileText className="w-4 h-4 shrink-0" />
              <span>No PDF attached. Contact the photographer if you need a copy.</span>
            </div>
          )}
        </div>

        {/* Trust signals */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: ShieldCheck, label: "Secure", desc: "SSL encrypted" },
            { icon: Lock, label: "Private", desc: "Token-protected" },
            { icon: Clock, label: "Timestamped", desc: "Time-recorded" },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-3 text-center">
              <Icon className="w-4 h-4 text-violet-400 mx-auto mb-1" />
              <p className="text-xs font-semibold text-zinc-300">{label}</p>
              <p className="text-[10px] text-zinc-500">{desc}</p>
            </div>
          ))}
        </div>

        {/* Signing area */}
        {!alreadySigned && !signedAt && (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-6 space-y-5">
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <PenLine className="w-4 h-4 text-violet-400" />
              Sign This Contract
            </h3>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
                <User className="w-3 h-3" />Your Full Legal Name
              </label>
              <Input
                placeholder="e.g. Alex Chen"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter" && agreed) handleSign(); }}
                disabled={signing}
              />
              <p className="text-[10px] text-zinc-500">This typed name will be recorded as your electronic signature.</p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 accent-violet-600"
              />
              <span className="text-xs text-zinc-400 leading-relaxed">
                I confirm that I have read and understood the contract above, and I agree to be bound by its terms and conditions. I understand that my typed name constitutes a legally binding electronic signature.
              </span>
            </label>

            {/* Preview of signature */}
            {fullName.trim() && (
              <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Signature Preview</p>
                <p className="font-serif text-lg text-violet-300 italic">{fullName}</p>
              </div>
            )}

            <Button
              onClick={handleSign}
              disabled={signing || !fullName.trim() || !agreed}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white gap-2"
            >
              {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
              {signing ? "Signing…" : "Sign Contract"}
            </Button>

            <p className="text-[10px] text-zinc-500 text-center leading-relaxed">
              By clicking "Sign Contract" you confirm your identity and agreement to the terms above. Your IP address and timestamp will be recorded.
            </p>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
