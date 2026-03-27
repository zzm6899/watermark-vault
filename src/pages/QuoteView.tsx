/**
 * QuoteView — public page for clients to view and accept/decline a quote.
 * Accessed via /quote/:token — no login required.
 */
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle, FileText, Clock, DollarSign, User, Mail, MapPin, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getPublicQuote, respondToQuote } from "@/lib/api";
import type { Quote } from "@/lib/types";
import Footer from "@/components/Footer";

function calcTotal(quote: Quote): number {
  const sub = quote.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const tax = quote.tax ? sub * quote.tax / 100 : 0;
  const disc = quote.discount || 0;
  return sub + tax - disc;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function StatusBadge({ status }: { status: Quote["status"] }) {
  const map: Record<Quote["status"], { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-zinc-700 text-zinc-200" },
    sent: { label: "Awaiting Response", className: "bg-amber-500/20 text-amber-300 border border-amber-500/30" },
    accepted: { label: "Accepted", className: "bg-green-500/20 text-green-300 border border-green-500/30" },
    declined: { label: "Declined", className: "bg-red-500/20 text-red-300 border border-red-500/30" },
    expired: { label: "Expired", className: "bg-zinc-600/50 text-zinc-400" },
    converted: { label: "Converted to Invoice", className: "bg-blue-500/20 text-blue-300 border border-blue-500/30" },
  };
  const { label, className } = map[status] || { label: status, className: "bg-zinc-700 text-zinc-200" };
  return <span className={`px-3 py-1 rounded-full text-xs font-medium ${className}`}>{label}</span>;
}

export default function QuoteView() {
  const { token } = useParams<{ token: string }>();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);

  useEffect(() => {
    if (!token) { setError("Invalid link."); setLoading(false); return; }
    getPublicQuote(token)
      .then((q) => {
        if (!q) { setError("This quote could not be found. The link may be incorrect or expired."); return; }
        setQuote(q);
      })
      .catch(() => setError("Failed to load quote."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleRespond(action: "accept" | "decline") {
    if (!token || !quote) return;
    if (action === "accept" && !confirmName.trim()) {
      toast.error("Please enter your full name to accept.");
      return;
    }
    setResponding(true);
    try {
      const updated = await respondToQuote(token, action);
      if (!updated) { toast.error("Something went wrong. Please try again."); return; }
      setQuote(updated);
      setDone(action === "accept" ? "accepted" : "declined");
    } catch {
      toast.error("Request failed. Please try again.");
    } finally {
      setResponding(false);
      setShowDeclineConfirm(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="text-white text-lg font-semibold">Quote Not Found</p>
        <p className="text-zinc-400 text-sm max-w-sm">{error || "This link may be invalid or expired."}</p>
      </div>
    );
  }

  const isExpired = quote.expiryDate && new Date(quote.expiryDate) < new Date() && quote.status === "sent";
  const canRespond = quote.status === "sent" && !isExpired;
  const subtotal = quote.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const taxAmount = quote.tax ? subtotal * quote.tax / 100 : 0;
  const discount = quote.discount || 0;
  const total = calcTotal(quote);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header bar */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center">
            <FileText className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-zinc-200">Quote #{quote.number}</span>
        </div>
        <StatusBadge status={isExpired ? "expired" : quote.status} />
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        {/* Done confirmation banner */}
        {done === "accepted" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-xl p-4"
          >
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
            <div>
              <p className="text-green-300 font-semibold text-sm">Quote Accepted!</p>
              <p className="text-green-300/70 text-xs mt-0.5">The photographer has been notified and will be in touch shortly.</p>
            </div>
          </motion.div>
        )}
        {done === "declined" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4"
          >
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <p className="text-red-300 font-semibold text-sm">Quote Declined</p>
              <p className="text-red-300/70 text-xs mt-0.5">The photographer has been notified. Thank you for your response.</p>
            </div>
          </motion.div>
        )}

        {/* From / To */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-1">
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">From</p>
            <p className="text-sm font-semibold text-zinc-100">{quote.from.name || "—"}</p>
            {quote.from.email && <p className="text-xs text-zinc-400 flex items-center gap-1"><Mail className="w-3 h-3" />{quote.from.email}</p>}
            {quote.from.address && <p className="text-xs text-zinc-400 flex items-center gap-1"><MapPin className="w-3 h-3" />{quote.from.address}</p>}
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-1">
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">To</p>
            <p className="text-sm font-semibold text-zinc-100">{quote.to.name || "—"}</p>
            {quote.to.email && <p className="text-xs text-zinc-400 flex items-center gap-1"><Mail className="w-3 h-3" />{quote.to.email}</p>}
            {quote.to.address && <p className="text-xs text-zinc-400 flex items-center gap-1"><MapPin className="w-3 h-3" />{quote.to.address}</p>}
          </div>
        </div>

        {/* Meta info */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <FileText className="w-3.5 h-3.5 text-zinc-500" />
            <span>Quote <span className="text-zinc-200 font-medium">#{quote.number}</span></span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
            <span>Issued <span className="text-zinc-200 font-medium">{formatDate(quote.createdAt)}</span></span>
          </div>
          {quote.expiryDate && (
            <div className={`flex items-center gap-1.5 ${isExpired ? "text-red-400" : "text-zinc-400"}`}>
              <Clock className="w-3.5 h-3.5" />
              <span>Expires <span className={`font-medium ${isExpired ? "text-red-300" : "text-zinc-200"}`}>{formatDate(quote.expiryDate)}</span></span>
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-zinc-800/50 text-xs text-zinc-500 uppercase tracking-wider font-medium">
            <div className="col-span-6">Description</div>
            <div className="col-span-2 text-right">Qty</div>
            <div className="col-span-2 text-right">Unit Price</div>
            <div className="col-span-2 text-right">Amount</div>
          </div>
          {quote.items.map((item, i) => (
            <div key={item.id || i} className="grid grid-cols-12 gap-2 px-4 py-3 border-t border-zinc-800/60 text-sm">
              <div className="col-span-6 text-zinc-200">{item.description || "—"}</div>
              <div className="col-span-2 text-right text-zinc-400">{item.quantity}</div>
              <div className="col-span-2 text-right text-zinc-400">{formatCurrency(item.unitPrice)}</div>
              <div className="col-span-2 text-right text-zinc-200 font-medium">{formatCurrency(item.quantity * item.unitPrice)}</div>
            </div>
          ))}
          <div className="px-4 py-3 border-t border-zinc-700/50 space-y-1.5">
            <div className="flex justify-between text-sm text-zinc-400">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {taxAmount > 0 && (
              <div className="flex justify-between text-sm text-zinc-400">
                <span>Tax ({quote.tax}%)</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
            )}
            {discount > 0 && (
              <div className="flex justify-between text-sm text-green-400">
                <span>Discount</span>
                <span>–{formatCurrency(discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-white pt-1 border-t border-zinc-700/50 mt-1">
              <span className="flex items-center gap-1.5"><DollarSign className="w-4 h-4 text-violet-400" />Total</span>
              <span className="text-violet-300">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {quote.notes && (
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">Notes</p>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{quote.notes}</p>
          </div>
        )}

        {/* Expired notice */}
        {isExpired && (
          <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
            <Clock className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="text-amber-300 text-sm">This quote expired on {formatDate(quote.expiryDate)}. Please contact the photographer for an updated quote.</p>
          </div>
        )}

        {/* Action area — only when status is "sent" and not expired */}
        {canRespond && !done && (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-6 space-y-4">
            <p className="text-sm font-semibold text-zinc-100">Your Response</p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Review the quote above. If you're happy to proceed, enter your full name and click <strong className="text-zinc-200">Accept Quote</strong>. Your typed name serves as your digital confirmation.
            </p>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
                <User className="w-3 h-3" />Your Full Name (to accept)
              </label>
              <Input
                placeholder="e.g. Alex Chen"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") handleRespond("accept"); }}
              />
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => handleRespond("accept")}
                disabled={responding || !confirmName.trim()}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white gap-1.5"
              >
                {responding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Accept Quote
              </Button>
              {!showDeclineConfirm ? (
                <Button
                  variant="outline"
                  onClick={() => setShowDeclineConfirm(true)}
                  disabled={responding}
                  className="flex-1 border-red-500/40 text-red-400 hover:bg-red-500/10 gap-1.5"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Decline
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => handleRespond("decline")}
                  disabled={responding}
                  className="flex-1 border-red-500 text-red-300 hover:bg-red-500/20 gap-1.5"
                >
                  {responding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                  Confirm Decline
                </Button>
              )}
            </div>
            {showDeclineConfirm && !responding && (
              <p className="text-xs text-red-400 text-center">Are you sure? Click "Confirm Decline" to proceed.</p>
            )}
          </div>
        )}

        {/* Already responded */}
        {(quote.status === "accepted" && !done) && (
          <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-xl p-4">
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
            <div>
              <p className="text-green-300 font-semibold text-sm">Quote Accepted</p>
              {quote.acceptedAt && <p className="text-green-300/70 text-xs mt-0.5">Accepted on {formatDate(quote.acceptedAt)}</p>}
            </div>
          </div>
        )}
        {(quote.status === "declined" && !done) && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <p className="text-red-300 font-semibold text-sm">Quote Declined</p>
              {quote.declinedAt && <p className="text-red-300/70 text-xs mt-0.5">Declined on {formatDate(quote.declinedAt)}</p>}
            </div>
          </div>
        )}
        {(quote.status === "converted" && !done) && (
          <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
            <FileText className="w-5 h-5 text-blue-400 shrink-0" />
            <p className="text-blue-300 font-semibold text-sm">This quote has been converted to an invoice.</p>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
