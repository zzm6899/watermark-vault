import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import { motion } from "framer-motion";
import {
  Clock, ChevronLeft, ChevronRight, ArrowLeft,
  CalendarDays, CheckCircle2, XCircle, MapPin,
  Calendar as CalendarIcon, ExternalLink, CreditCard,
  Building2, Copy, Check as CheckIcon, AlertCircle,
  DollarSign, Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { getBookings, updateBooking, getEventTypes, getProfile, getSettings, isSlotBooked } from "@/lib/storage";
import { createBookingCheckout, getStripeStatus, syncBookingToCalendar } from "@/lib/api";
import type { EventType, Booking } from "@/lib/types";

function formatDuration(mins: number) {
  if (mins >= 60) { const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${mins}m`;
}
function formatTime12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function formatDateNice(dateStr: string) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
}
function getAvailabilityForDate(et: EventType, date: Date) {
  const dateStr = toDateStr(date);
  const avail = et.availability;
  if (!avail) return [];
  if ((avail.blockedDates || []).includes(dateStr)) return [];
  const specific = (avail.specificDates || []).filter(s => s.date === dateStr);
  if (specific.length > 0) return specific.map(s => ({ startTime: s.startTime, endTime: s.endTime }));
  return (avail.recurring || []).filter(s => s.day === date.getDay()).map(s => ({ startTime: s.startTime, endTime: s.endTime }));
}
function generateTimeSlots(startTime: string, endTime: string, duration: number): string[] {
  const slots: string[] = [];
  const [sh,sm] = startTime.split(":").map(Number);
  const [eh,em] = endTime.split(":").map(Number);
  for (let m = sh*60+sm; m+duration <= eh*60+em; m += duration)
    slots.push(`${Math.floor(m/60).toString().padStart(2,"0")}:${(m%60).toString().padStart(2,"0")}`);
  return slots;
}
function buildGoogleCalendarUrl(event: EventType, date: Date, time: string, duration: number) {
  const [h,m] = time.split(":").map(Number);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
  const end = new Date(start.getTime() + duration * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({ action:"TEMPLATE", text:event.title, dates:`${fmt(start)}/${fmt(end)}`, details:event.description||"", location:event.location||"" })}`;
}

export default function BookingModify() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const profile = getProfile();
  const settings = getSettings();

  const [booking, setBooking] = useState<Booking | undefined>(
    () => getBookings().find(b => b.modifyToken === bookingId || b.id === bookingId)
  );
  const eventType = booking ? getEventTypes().find(e => e.id === booking.eventTypeId) : null;

  const [mode, setMode] = useState<"status"|"reschedule"|"done">("status");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [use24h, setUse24h] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth()));

  useEffect(() => { getStripeStatus().then(s => setStripeAvailable(s.configured)); }, []);

  usePageTitle(
    eventType && booking
      ? `${eventType.title} — ${formatDateNice(booking.date)}`
      : "Manage Booking"
  );

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const blanks = Array.from({ length: (new Date(year,month,1).getDay()+6)%7 });
  const days = Array.from({ length: daysInMonth }, (_, i) => i+1);

  const timeSlots = useMemo(() => {
    if (!selectedDate || !booking || !eventType) return [];
    const dateStr = toDateStr(selectedDate);
    return getAvailabilityForDate(eventType, selectedDate)
      .flatMap(r => generateTimeSlots(r.startTime, r.endTime, booking.duration))
      .filter(t => !isSlotBooked(dateStr, t, booking.duration));
  }, [selectedDate, booking, eventType]);

  const handleCancel = useCallback(() => {
    if (!booking || !confirm("Cancel this booking?")) return;
    const updated = { ...booking, status: "cancelled" as const };
    updateBooking(updated);
    setBooking(updated);
    // Update calendar event to reflect cancellation (changes event color to grey)
    if (booking.gcalEventId) {
      syncBookingToCalendar(updated).catch(() => {});
    }
  }, [booking]);

  const handleReschedule = useCallback(() => {
    if (!booking || !selectedDate || !selectedTime) return;
    const dateStr = toDateStr(selectedDate);
    if (isSlotBooked(dateStr, selectedTime, booking.duration)) { toast.error("Slot just taken, pick another."); return; }
    const updated = { ...booking, date: dateStr, time: selectedTime };
    updateBooking(updated);
    setBooking(updated);
    // Push reschedule to Google Calendar — update existing event if we have its ID
    syncBookingToCalendar(updated).then(res => {
      if (res?.eventId) updateBooking({ ...updated, gcalEventId: res.eventId });
    }).catch(() => {});
    setMode("done");
  }, [booking, selectedDate, selectedTime]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (!booking || !eventType) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="glass-panel rounded-xl p-8 text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-2">Booking Not Found</h2>
          <p className="text-sm font-body text-muted-foreground mb-4">This link may have expired or the booking was removed.</p>
          <Button onClick={() => navigate("/")} variant="outline" className="font-body text-xs">Book a New Session</Button>
        </div>
      </div>
    );
  }

  const depositAmt = booking.depositAmount ?? 0;
  const totalAmt = booking.paymentAmount ?? eventType.price ?? 0;
  const remainingAmt = Math.max(0, totalAmt - depositAmt);
  const isDepositPaid = booking.paymentStatus === "deposit-paid";
  const isPaidInFull = booking.paymentStatus === "paid" || booking.paymentStatus === "cash";
  const isBankPending = booking.paymentStatus === "pending-confirmation";
  const isFree = totalAmt === 0;
  const depositEnabled = booking.depositRequired && depositAmt > 0;
  const depositMethods = eventType.depositMethods || ["stripe", "bank"];
  const bankTransfer = settings.bankTransfer;
  const bookingDate = (() => { const [y,mo,d] = booking.date.split("-").map(Number); return new Date(y,mo-1,d); })();

  const handleStripePayment = async (amount: number) => {
    setProcessingPayment(true);
    const result = await createBookingCheckout({ bookingId: booking.id, clientName: booking.clientName, clientEmail: booking.clientEmail, amount, eventTitle: eventType.title });
    setProcessingPayment(false);
    if (result.url) window.location.href = result.url;
    else toast.error(result.error || "Payment failed");
  };

  // ── Rescheduled confirmation ──
  if (mode === "done" && selectedDate && selectedTime) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="glass-panel rounded-xl p-8 text-center max-w-md w-full">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-6">Booking Rescheduled!</h2>
          <div className="border-t border-border/50 pt-4 space-y-2 text-left">
            <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Event</span><span className="text-foreground">{eventType.title}</span></div>
            <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">New Date</span><span className="text-foreground">{formatDateNice(toDateStr(selectedDate))}</span></div>
            <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">New Time</span><span className="text-primary font-medium">{formatTime12(selectedTime)}</span></div>
          </div>
          <a href={buildGoogleCalendarUrl(eventType, selectedDate, selectedTime, booking.duration)} target="_blank" rel="noopener noreferrer" className="block mt-4">
            <Button variant="outline" className="w-full font-body text-xs gap-2"><CalendarIcon className="w-4 h-4" /> Update Google Calendar <ExternalLink className="w-3 h-3" /></Button>
          </a>
          <Button onClick={() => setMode("status")} variant="ghost" className="w-full mt-2 font-body text-xs text-muted-foreground">Back to Booking</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <section className="min-h-screen" style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)", paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}>
        <div className="container mx-auto px-4">

          {mode === "status" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto">
              <div className="glass-panel rounded-xl p-8 mb-4">

                {/* Header icon + title */}
                <div className="text-center mb-6">
                  {booking.status === "cancelled"
                    ? <><Ban className="w-12 h-12 text-destructive mx-auto mb-3" /><h2 className="font-display text-2xl text-foreground">Booking Cancelled</h2></>
                    : <><CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" /><h2 className="font-display text-2xl text-foreground">{booking.status === "confirmed" || booking.status === "completed" ? "Booking Confirmed" : "Booking Pending"}</h2><p className="text-sm font-body text-muted-foreground mt-1">{booking.status === "pending" ? "Awaiting confirmation." : "You're all set!"}</p></>
                  }
                </div>

                {/* Details */}
                <div className="border-t border-border/50 pt-4 space-y-2.5">
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Event</span><span className="text-foreground font-medium">{eventType.title}</span></div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Duration</span><span className="text-foreground">{formatDuration(booking.duration)}</span></div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Date</span><span className="text-foreground">{formatDateNice(booking.date)}</span></div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Time</span><span className="text-primary font-medium">{formatTime12(booking.time)}</span></div>
                  {eventType.location && <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Location</span><span className="text-foreground">{eventType.location}</span></div>}
                  <div className="flex justify-between text-sm font-body items-center">
                    <span className="text-muted-foreground">Status</span>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-body ${booking.status === "confirmed" || booking.status === "completed" ? "bg-green-500/10 text-green-400" : booking.status === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-yellow-500/10 text-yellow-400"}`}>
                      {booking.status === "confirmed" ? "Confirmed" : booking.status === "completed" ? "Completed" : booking.status === "cancelled" ? "Cancelled" : "Pending"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Ref</span><span className="font-mono text-xs text-muted-foreground">{booking.id}</span></div>
                </div>

                {/* Payment status */}
                {!isFree && (
                  <div className="border-t border-border/50 pt-4 mt-4 space-y-2">
                    <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-3">Payment</p>
                    {isPaidInFull && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                        <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /><span className="text-sm font-body text-green-400 font-medium">Paid in Full</span></div>
                        <span className="text-sm font-body text-green-400 font-medium">${totalAmt}</span>
                      </div>
                    )}
                    {isDepositPaid && (
                      <>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-teal-500/10 border border-teal-500/20">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400" /><span className="text-sm font-body text-teal-400 font-medium">Deposit Paid</span></div>
                          <span className="text-sm font-body text-teal-400 font-medium">${depositAmt}</span>
                        </div>
                        {remainingAmt > 0 && (
                          <div className="flex items-center justify-between p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <div className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-yellow-400" /><span className="text-sm font-body text-yellow-400 font-medium">Remaining Balance</span></div>
                            <span className="text-sm font-body text-yellow-400 font-medium">${remainingAmt}</span>
                          </div>
                        )}
                      </>
                    )}
                    {isBankPending && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                        <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-400" /><span className="text-sm font-body text-blue-400 font-medium">Bank Transfer Pending</span></div>
                        <span className="text-sm font-body text-blue-400 font-medium">${depositEnabled ? depositAmt : totalAmt}</span>
                      </div>
                    )}
                    {!isPaidInFull && !isDepositPaid && !isBankPending && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-destructive" /><span className="text-sm font-body text-destructive font-medium">Payment Required</span></div>
                        <span className="text-sm font-body text-destructive font-medium">${depositEnabled ? depositAmt : totalAmt}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Pay now buttons */}
                {!isFree && !isPaidInFull && booking.status !== "cancelled" && (
                  <div className="mt-4 space-y-2.5">
                    {isDepositPaid && remainingAmt > 0 && (
                      <>
                        <p className="text-xs font-body text-muted-foreground">Pay your remaining balance:</p>
                        {stripeAvailable && <Button onClick={() => handleStripePayment(remainingAmt)} disabled={processingPayment} className="w-full gap-2 bg-primary text-primary-foreground font-body text-sm h-11"><CreditCard className="w-4 h-4" />{processingPayment ? "Redirecting…" : `Pay Remaining $${remainingAmt} with Card`}</Button>}
                        {bankTransfer.enabled && <Button onClick={() => setShowBankDetails(!showBankDetails)} variant="outline" className="w-full gap-2 border-border text-foreground font-body text-sm h-11"><Building2 className="w-4 h-4" />Bank Transfer / PayID</Button>}
                      </>
                    )}
                    {!isDepositPaid && !isBankPending && (
                      <>
                        <p className="text-xs font-body text-muted-foreground">{depositEnabled ? `Pay your $${depositAmt} deposit:` : `Pay $${totalAmt} to confirm:`}</p>
                        {stripeAvailable && <Button onClick={() => handleStripePayment(depositEnabled ? depositAmt : totalAmt)} disabled={processingPayment} className="w-full gap-2 bg-primary text-primary-foreground font-body text-sm h-11"><CreditCard className="w-4 h-4" />{processingPayment ? "Redirecting…" : `Pay $${depositEnabled ? depositAmt : totalAmt} with Card`}</Button>}
                        {bankTransfer.enabled && <Button onClick={() => setShowBankDetails(!showBankDetails)} variant="outline" className="w-full gap-2 border-border text-foreground font-body text-sm h-11"><Building2 className="w-4 h-4" />Bank Transfer / PayID</Button>}
                      </>
                    )}
                    {showBankDetails && bankTransfer.enabled && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-2 pt-1">
                        {bankTransfer.accountName && <div className="flex items-center justify-between p-3 rounded-lg bg-secondary"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Account Name</p><p className="text-sm font-body text-foreground font-medium">{bankTransfer.accountName}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(bankTransfer.accountName,"name")}>{copiedField==="name"?<CheckIcon className="w-4 h-4 text-primary"/>:<Copy className="w-4 h-4"/>}</Button></div>}
                        {bankTransfer.bsb && <div className="flex items-center justify-between p-3 rounded-lg bg-secondary"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">BSB</p><p className="text-sm font-body text-foreground font-medium">{bankTransfer.bsb}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(bankTransfer.bsb,"bsb")}>{copiedField==="bsb"?<CheckIcon className="w-4 h-4 text-primary"/>:<Copy className="w-4 h-4"/>}</Button></div>}
                        {bankTransfer.accountNumber && <div className="flex items-center justify-between p-3 rounded-lg bg-secondary"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Account Number</p><p className="text-sm font-body text-foreground font-medium">{bankTransfer.accountNumber}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(bankTransfer.accountNumber,"acc")}>{copiedField==="acc"?<CheckIcon className="w-4 h-4 text-primary"/>:<Copy className="w-4 h-4"/>}</Button></div>}
                        {bankTransfer.payId && <div className="flex items-center justify-between p-3 rounded-lg bg-secondary"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">PayID ({bankTransfer.payIdType})</p><p className="text-sm font-body text-foreground font-medium">{bankTransfer.payId}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(bankTransfer.payId,"payid")}>{copiedField==="payid"?<CheckIcon className="w-4 h-4 text-primary"/>:<Copy className="w-4 h-4"/>}</Button></div>}
                        {bankTransfer.instructions && <div className="p-3 rounded-lg bg-primary/5 border border-primary/10"><p className="text-xs font-body text-muted-foreground">{bankTransfer.instructions}</p></div>}
                        <p className="text-xs font-body text-muted-foreground text-center">Reference: <span className="text-primary font-medium">{booking.id}</span></p>
                      </motion.div>
                    )}
                  </div>
                )}

                {/* Actions */}
                {booking.status !== "cancelled" && (
                  <div className="flex flex-col gap-3 mt-6 border-t border-border/50 pt-5">
                    <a href={buildGoogleCalendarUrl(eventType, bookingDate, booking.time, booking.duration)} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" className="w-full font-body text-xs tracking-wider uppercase gap-2"><CalendarIcon className="w-4 h-4" /> Add to Google Calendar <ExternalLink className="w-3 h-3" /></Button>
                    </a>
                    <Button onClick={() => setMode("reschedule")} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2"><CalendarDays className="w-4 h-4" /> Change Date / Time</Button>
                    <Button onClick={handleCancel} variant="outline" className="w-full font-body text-xs tracking-wider uppercase border-destructive text-destructive hover:bg-destructive/10 gap-2"><XCircle className="w-4 h-4" /> Cancel Booking</Button>
                  </div>
                )}
              </div>
              <p className="text-center text-xs font-body text-muted-foreground/40">{profile.name}</p>
            </motion.div>
          )}

          {mode === "reschedule" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-[900px] mx-auto">
              <button onClick={() => setMode("status")} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-4">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="grid lg:grid-cols-[1fr_240px] divide-y lg:divide-y-0 lg:divide-x divide-border/50">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="font-display text-base text-foreground"><span className="text-primary">{currentMonth.toLocaleDateString("en-US",{month:"long"})}</span> {year}</h3>
                      <div className="flex gap-1">
                        <button onClick={() => setCurrentMonth(new Date(year,month-1))} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground"><ChevronLeft className="w-4 h-4" /></button>
                        <button onClick={() => setCurrentMonth(new Date(year,month+1))} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground"><ChevronRight className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-1 mb-2">{["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d=><div key={d} className="text-center text-[10px] font-body tracking-wider uppercase text-muted-foreground py-2">{d}</div>)}</div>
                    <div className="grid grid-cols-7 gap-1">
                      {blanks.map((_,i)=><div key={i}/>)}
                      {days.map(day=>{
                        const date=new Date(year,month,day);
                        const isSelected=selectedDate?.getDate()===day&&selectedDate?.getMonth()===month&&selectedDate?.getFullYear()===year;
                        const isPast=date<new Date(new Date().setHours(0,0,0,0));
                        const isAvail=!isPast&&getAvailabilityForDate(eventType,date).length>0;
                        const isToday=toDateStr(date)===toDateStr(new Date());
                        return <button key={day} disabled={!isAvail} onClick={()=>{setSelectedDate(date);setSelectedTime(null);}} className={`aspect-square rounded-lg text-sm font-body transition-all relative ${isSelected?"bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background":isAvail?"text-foreground hover:bg-secondary":"text-muted-foreground/20 cursor-not-allowed"}`}>{day}{isToday&&!isSelected&&<span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"/>}</button>;
                      })}
                    </div>
                  </div>
                  <div className="p-4">
                    {selectedDate ? (
                      <motion.div initial={{opacity:0}} animate={{opacity:1}}>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-body font-medium text-foreground">{selectedDate.toLocaleDateString("en-US",{weekday:"short"})} {selectedDate.getDate()}</p>
                          <div className="flex rounded-md border border-border overflow-hidden">
                            <button onClick={()=>setUse24h(false)} className={`px-2 py-0.5 text-[10px] font-body ${!use24h?"bg-secondary text-foreground":"text-muted-foreground"}`}>12h</button>
                            <button onClick={()=>setUse24h(true)} className={`px-2 py-0.5 text-[10px] font-body ${use24h?"bg-secondary text-foreground":"text-muted-foreground"}`}>24h</button>
                          </div>
                        </div>
                        <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                          {timeSlots.length>0?timeSlots.map(t=>(
                            <button key={t} onClick={()=>setSelectedTime(t)} className={`w-full text-sm font-body py-2.5 px-4 rounded-lg border transition-all text-center ${selectedTime===t?"bg-primary text-primary-foreground border-primary":"border-border text-foreground hover:border-primary/50"}`}>
                              <span className="flex items-center justify-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-400"/>{use24h?t:formatTime12(t)}</span>
                            </button>
                          )):<p className="text-sm font-body text-muted-foreground/50 text-center py-8">No slots available</p>}
                        </div>
                        {selectedTime && <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="mt-3"><Button onClick={handleReschedule} className="w-full bg-primary text-primary-foreground font-body tracking-wider uppercase text-xs py-5">Confirm New Time</Button></motion.div>}
                      </motion.div>
                    ) : (
                      <div className="text-center py-12"><CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3"/><p className="text-xs font-body text-muted-foreground/50">Select a date</p></div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}
