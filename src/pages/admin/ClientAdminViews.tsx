import React, { useState } from "react";
import DOMPurify from "dompurify";
import { motion } from "framer-motion";
import { Calendar, Camera, CheckCircle2, ChevronDown, Clock, Download, Edit, Image, Mail, MessageSquare, Plus, Receipt, Save, Search, Trash2, Upload, Users, X, XSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RichTextEditor from "@/components/RichTextEditor";
import { toast } from "sonner";
import {
  addBooking, addContact, deleteContact, deleteEnquiry, getAlbums, getBookings,
  getContacts, getEnquiries, getEventTypes, getInvoices, getProfile, setProfile,
  updateContact, updateEnquiry,
} from "@/lib/storage";
import { ensurePublicAlbumAvailable, sendEnquiryAcceptedEmail, sendEnquiryDeclinedEmail } from "@/lib/api";
import { generateCapabilityToken } from "@/lib/capability-token";
import { calcInvTotal, formatInvMoney, invoiceCurrency } from "@/lib/admin-invoice-utils";
import type { Album, Booking, Contact, Enquiry, EnquiryStatus, Invoice, ProfileSettings } from "@/lib/types";

function generateId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function ensurePublicShareReady(album: Album, action = "share this gallery"): Promise<boolean> {
  toast.loading("Checking public gallery...", { id: `public-share-${album.id}` });
  const result = await ensurePublicAlbumAvailable(album);
  if (result.ok) {
    toast.success("Public gallery is live", { id: `public-share-${album.id}` });
    return true;
  }
  toast.error(result.error || `Cannot ${action} until the gallery is published.`, { id: `public-share-${album.id}` });
  return false;
}

const ENQ_STATUS_META: Record<EnquiryStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "text-yellow-400", bg: "bg-yellow-500/10" },
  accepted: { label: "Accepted", color: "text-green-400", bg: "bg-green-500/10" },
  declined: { label: "Declined", color: "text-gray-400", bg: "bg-gray-500/10" },
};
function EnquiriesView() {
  const eventTypes = getEventTypes();
  const [enquiries, setEnquiriesState] = React.useState<Enquiry[]>(() =>
    getEnquiries().slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  );
  const [filter, setFilter] = React.useState<EnquiryStatus | "all">("pending");
  const [decliningId, setDecliningId] = React.useState<string | null>(null);
  const [adminNoteInput, setAdminNoteInput] = React.useState("");

  const reload = () =>
    setEnquiriesState(
      getEnquiries().slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    );

  const handleAccept = (enq: Enquiry) => {
    const now = new Date().toISOString();
    const modifyToken = generateCapabilityToken("mod");
    const matchedEvent = enq.eventTypeId ? eventTypes.find(e => e.id === enq.eventTypeId) : null;
    const booking: Booking = {
      id: `bk-${Date.now()}`,
      clientName: enq.name,
      clientEmail: enq.email,
      date: enq.preferredDate || now.slice(0, 10),
      time: enq.preferredStartTime || "09:00",
      eventTypeId: enq.eventTypeId || "",
      type: enq.eventTypeTitle || matchedEvent?.title || "Custom Enquiry",
      duration: 60,
      status: "pending",
      notes: `Enquiry: ${enq.message}`,
      answers: {},
      answerLabels: {},
      createdAt: now,
      paymentStatus: "unpaid",
      paymentAmount: matchedEvent?.price || 0,
      instagramHandle: "",
      modifyToken,
    };
    addBooking(booking);
    const updated: Enquiry = { ...enq, status: "accepted", respondedAt: now, bookingId: booking.id };
    updateEnquiry(updated);
    reload();
    toast.success(`Enquiry accepted — booking created for ${enq.name}. Check the Bookings tab.`);
    sendEnquiryAcceptedEmail({
      to: enq.email,
      clientName: enq.name,
      eventTitle: enq.eventTypeTitle || matchedEvent?.title,
      preferredDate: enq.preferredDate,
      preferredStartTime: enq.preferredStartTime,
      preferredEndTime: enq.preferredEndTime,
      bookingId: booking.id,
      modifyToken,
    }).catch(() => {});
  };

  const handleDecline = (enq: Enquiry) => {
    setDecliningId(enq.id);
    setAdminNoteInput("");
  };

  const confirmDecline = (enq: Enquiry) => {
    const note = adminNoteInput.trim() || undefined;
    const updated: Enquiry = {
      ...enq,
      status: "declined",
      respondedAt: new Date().toISOString(),
      adminNote: note,
    };
    updateEnquiry(updated);
    setDecliningId(null);
    reload();
    toast.success("Enquiry declined");
    sendEnquiryDeclinedEmail({
      to: enq.email,
      clientName: enq.name,
      adminNote: note,
    }).catch(() => {});
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this enquiry?")) return;
    deleteEnquiry(id);
    reload();
  };

  const filtered = enquiries.filter(e => filter === "all" || e.status === filter);
  const pendingCount = enquiries.filter(e => e.status === "pending").length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center gap-3 mb-6">
        <h2 className="font-display text-2xl text-foreground">Enquiries</h2>
        {pendingCount > 0 && (
          <span className="bg-yellow-500/15 text-yellow-400 text-xs font-body px-2 py-0.5 rounded-full">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {(["pending", "all", "accepted", "declined"] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-body capitalize transition-colors ${
              filter === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "all" ? "All" : ENQ_STATUS_META[s].label}
            {" "}
            ({s === "all" ? enquiries.length : enquiries.filter(e => e.status === s).length})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <MessageSquare className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm font-body text-muted-foreground">
            {filter === "pending" ? "No pending enquiries" : `No ${filter} enquiries`}
          </p>
          <p className="text-xs font-body text-muted-foreground/50 mt-1">
            Enable the Enquiry form in Settings → Booking Settings to start receiving enquiries.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(enq => {
            const meta = ENQ_STATUS_META[enq.status];
            const matchedEvent = enq.eventTypeId ? eventTypes.find(e => e.id === enq.eventTypeId) : null;
            return (
              <div key={enq.id} className="glass-panel rounded-xl p-5">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-body text-sm text-foreground font-medium">{enq.name}</p>
                      <span className={`inline-flex items-center text-[10px] font-body px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-body text-muted-foreground">
                      <span>{enq.email}</span>
                      {enq.phone && <span>· {enq.phone}</span>}
                    </div>
                  </div>
                  <p className="text-[10px] font-body text-muted-foreground/50 shrink-0">
                    {new Date(enq.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>

                {/* Tags: event type, date, time range */}
                {(matchedEvent || enq.eventTypeTitle || enq.preferredDate || enq.preferredStartTime || enq.preferredEndTime) && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {(matchedEvent?.title || enq.eventTypeTitle) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-body bg-primary/10 text-primary px-2 py-1 rounded-full">
                        <Clock className="w-3 h-3" /> {matchedEvent?.title || enq.eventTypeTitle}
                      </span>
                    )}
                    {enq.preferredDate && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-body bg-secondary text-muted-foreground px-2 py-1 rounded-full">
                        <Calendar className="w-3 h-3" />
                        {new Date(enq.preferredDate + "T12:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                    {(enq.preferredStartTime || enq.preferredEndTime) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-body bg-secondary text-muted-foreground px-2 py-1 rounded-full">
                        <Clock className="w-3 h-3" />
                        {[enq.preferredStartTime, enq.preferredEndTime].filter(Boolean).join(" – ")}
                      </span>
                    )}
                  </div>
                )}

                {/* Message */}
                <p className="text-xs font-body text-muted-foreground bg-secondary/50 rounded-lg p-3 mb-4 whitespace-pre-line">
                  {enq.message}
                </p>

                {enq.adminNote && (
                  <p className="text-xs font-body text-muted-foreground/70 italic mb-3">Note: {enq.adminNote}</p>
                )}
                {enq.bookingId && (
                  <p className="text-xs font-body text-green-400/80 mb-3">✓ Booking created — view it in the Bookings tab</p>
                )}

                {/* Actions */}
                {decliningId === enq.id ? (
                  <div className="space-y-2">
                    <input
                      value={adminNoteInput}
                      onChange={e => setAdminNoteInput(e.target.value)}
                      placeholder="Decline note (optional — client won't see this)"
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDecliningId(null)} className="font-body text-xs">Cancel</Button>
                      <Button size="sm" onClick={() => confirmDecline(enq)} className="font-body text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                        Confirm Decline
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap items-center">
                    {enq.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleAccept(enq)}
                          className="font-body text-xs gap-1.5 bg-green-600/90 hover:bg-green-600 text-white"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Accept & Create Booking
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDecline(enq)}
                          className="font-body text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                        >
                          <XSquare className="w-3.5 h-3.5" /> Decline
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(enq.id)}
                      className="font-body text-xs text-muted-foreground hover:text-destructive ml-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ─── Invoices ──────────────────────────────────────────

function ProfileView() {
  const [profile, setProfileState] = useState<ProfileSettings>(getProfile());

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProfileState({ ...profile, avatar: reader.result as string });
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!profile.name.trim()) { toast.error("Name is required"); return; }
    setProfile(profile);
    toast.success("Profile saved!");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Profile & Cover Page</h2>
      <div className="max-w-lg space-y-6">
        <div className="glass-panel rounded-xl p-6">
          <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-4">Preview</p>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
              {profile.avatar ? <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" /> : <Camera className="w-6 h-6 text-primary" />}
            </div>
          </div>
          <h3 className="font-display text-xl text-foreground">{profile.name || "Your Name"}</h3>
          {profile.bio && <p className="text-sm font-body text-muted-foreground mt-1" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(profile.bio) }} />}
        </div>

        <div className="glass-panel rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-4">
            <label className="cursor-pointer">
              <div className="w-16 h-16 rounded-full bg-secondary border-2 border-dashed border-border flex items-center justify-center overflow-hidden">
                {profile.avatar ? <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" /> : <Upload className="w-5 h-5 text-muted-foreground/50" />}
              </div>
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </label>
            <div>
              <p className="text-xs font-body text-muted-foreground">Click to upload avatar</p>
              {profile.avatar && <button onClick={() => setProfileState({ ...profile, avatar: "" })} className="text-xs font-body text-destructive hover:underline">Remove</button>}
            </div>
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Display Name</label>
            <Input value={profile.name} onChange={(e) => setProfileState({ ...profile, name: e.target.value })} className="bg-secondary border-border text-foreground font-body" />
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Bio</label>
            <RichTextEditor value={profile.bio} onChange={(val) => setProfileState({ ...profile, bio: val })} minHeight="80px" />
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Timezone</label>
            <Input value={profile.timezone} onChange={(e) => setProfileState({ ...profile, timezone: e.target.value })} className="bg-secondary border-border text-foreground font-body" />
          </div>
          <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
            <Save className="w-4 h-4" /> Save Profile
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Contacts ────────────────────────────────────────
type ClientTimelineItem = {
  id: string;
  at: string;
  type: "booking" | "invoice" | "album" | "download" | "email";
  title: string;
  detail: string;
};

function contactMatchesClient(contact: Contact, name?: string, email?: string): boolean {
  const contactEmail = contact.email.trim().toLowerCase();
  const candidateEmail = (email || "").trim().toLowerCase();
  if (contactEmail && candidateEmail && contactEmail === candidateEmail) return true;
  return !!contact.name && !!name && contact.name.trim().toLowerCase() === name.trim().toLowerCase();
}

function buildClientTimeline(contact: Contact, bookings: Booking[], invoices: Invoice[], albums: Album[]): ClientTimelineItem[] {
  const items: ClientTimelineItem[] = [];
  const matchedBookings = bookings.filter(booking => contactMatchesClient(contact, booking.clientName, booking.clientEmail));
  const matchedInvoices = invoices.filter(invoice => contactMatchesClient(contact, invoice.to?.name, invoice.to?.email));
  const linkedAlbumIds = new Set(contact.albumIds || []);
  const matchedAlbums = albums.filter(album => linkedAlbumIds.has(album.id) || contactMatchesClient(contact, album.clientName, album.clientEmail));

  for (const booking of matchedBookings) {
    items.push({
      id: `booking-${booking.id}`,
      at: `${booking.date || booking.createdAt}T${booking.time || "00:00"}`,
      type: "booking",
      title: `${booking.type || "Booking"} ${booking.status}`,
      detail: `${booking.date}${booking.time ? ` at ${booking.time}` : ""}${booking.paymentStatus ? ` · ${booking.paymentStatus.replace("-", " ")}` : ""}`,
    });
    for (const entry of booking.emailLog || []) {
      const sentAt = entry.sentAt || entry.at || entry.createdAt;
      if (!sentAt) continue;
      items.push({
        id: `email-${booking.id}-${sentAt}`,
        at: sentAt,
        type: "email",
        title: entry.subject || entry.type || "Email sent",
        detail: `Booking email${entry.to ? ` to ${entry.to}` : ""}`,
      });
    }
  }

  for (const invoice of matchedInvoices) {
    items.push({
      id: `invoice-${invoice.id}`,
      at: invoice.paidAt || invoice.sentAt || invoice.createdAt,
      type: "invoice",
      title: `${invoice.number} ${invoice.status}`,
      detail: `${formatInvMoney(invoice, calcInvTotal(invoice))} · due ${invoice.dueDate || "not set"}`,
    });
  }

  for (const album of matchedAlbums) {
    const count = album.photoCount || album.photos?.length || 0;
    items.push({
      id: `album-${album.id}`,
      at: album.deliveredAt || album.date || new Date().toISOString(),
      type: "album",
      title: `${album.title} ${album.status || "album"}`,
      detail: `${count} photo${count !== 1 ? "s" : ""}`,
    });
    for (const entry of album.downloadHistory || []) {
      const downloadCount = entry.photoCount ?? entry.photoIds?.length ?? 0;
      items.push({
        id: `download-${album.id}-${entry.downloadedAt}`,
        at: entry.downloadedAt,
        type: "download",
        title: "Gallery downloaded",
        detail: `${downloadCount} photo${downloadCount !== 1 ? "s" : ""} · ${entry.quality || "original"}`,
      });
    }
  }

  return items
    .filter(item => item.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 12);
}

function ContactsView() {
  const [contacts, setContactsState] = useState<Contact[]>(() => getContacts());
  const [editing, setEditing] = useState<Contact | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);
  const bookings = getBookings();
  const invoices = getInvoices();
  const albums = getAlbums();

  const emptyContact = (): Contact => ({
    id: generateId("contact"),
    name: "",
    email: "",
    address: "",
    abn: "",
    taxNumber: "",
    vatId: "",
    iban: "",
    bicSwift: "",
    accountHolder: "",
    bankName: "",
    accountNumber: "",
    paymentProvider: "bank",
    wiseEmail: "",
    revolutHandle: "",
    paypalEmail: "",
    phone: "",
    company: "",
    albumIds: [],
    notes: "",
    createdAt: new Date().toISOString(),
  });

  const reload = () => setContactsState(getContacts());

  const handleSave = () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error("Name is required"); return; }
    const exists = contacts.find(c => c.id === editing.id);
    if (exists) { updateContact(editing); toast.success("Contact updated"); }
    else { addContact(editing); toast.success("Contact saved"); }
    reload();
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this contact?")) return;
    deleteContact(id);
    reload();
    toast.success("Contact deleted");
  };

  const filtered = contacts.filter(c =>
    !searchQuery ||
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.company || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const fieldClass = "w-full bg-secondary border border-border text-foreground font-body text-sm rounded-lg px-3 py-2 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50";
  const labelClass = "block text-[10px] font-body uppercase tracking-wider text-muted-foreground mb-1.5";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Contacts</h2>
        <Button onClick={() => setEditing(emptyContact())} className="gap-2 font-body text-sm">
          <Plus className="w-4 h-4" /> New Contact
        </Button>
      </div>

      {/* Edit / Create panel */}
      {editing && (
        <div className="glass-panel rounded-xl p-5 mb-6 space-y-4 max-w-lg">
          <h3 className="font-display text-base text-foreground">{contacts.find(c => c.id === editing.id) ? "Edit Contact" : "New Contact"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Name *</label>
              <input className={fieldClass} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Full name" />
            </div>
            <div>
              <label className={labelClass}>Company</label>
              <input className={fieldClass} value={editing.company || ""} onChange={e => setEditing({ ...editing, company: e.target.value })} placeholder="Business name" />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input className={fieldClass} type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input className={fieldClass} value={editing.phone || ""} onChange={e => setEditing({ ...editing, phone: e.target.value })} placeholder="+61 4xx xxx xxx" />
            </div>
            <div>
              <label className={labelClass}>ABN</label>
              <input className={fieldClass} value={editing.abn || ""} onChange={e => setEditing({ ...editing, abn: e.target.value })} placeholder="12 345 678 901" />
            </div>
            <div>
              <label className={labelClass}>Tax Number</label>
              <input className={fieldClass} value={editing.taxNumber || ""} onChange={e => setEditing({ ...editing, taxNumber: e.target.value })} placeholder="Tax number" />
            </div>
            <div>
              <label className={labelClass}>VAT ID</label>
              <input className={fieldClass} value={editing.vatId || ""} onChange={e => setEditing({ ...editing, vatId: e.target.value })} placeholder="VAT identification number" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Address</label>
              <textarea className={fieldClass} rows={2} value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} placeholder="Street address" />
            </div>
            <div className="sm:col-span-2 rounded-lg border border-border/60 bg-secondary/30 p-3 space-y-2">
              <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">International Payment Details</p>
              <div>
                <label className={labelClass}>Payment Preference</label>
                <select className={fieldClass} value={editing.paymentProvider || "bank"} onChange={e => setEditing({ ...editing, paymentProvider: e.target.value as Contact["paymentProvider"] })}>
                  <option value="bank">European IBAN / Bank Transfer</option>
                  <option value="wise">Wise</option>
                  <option value="revolut">Revolut</option>
                  <option value="paypal">PayPal</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label className={labelClass}>Account Holder</label><input className={fieldClass} value={editing.accountHolder || ""} onChange={e => setEditing({ ...editing, accountHolder: e.target.value })} /></div>
                <div><label className={labelClass}>Bank Name</label><input className={fieldClass} value={editing.bankName || ""} onChange={e => setEditing({ ...editing, bankName: e.target.value })} /></div>
                <div><label className={labelClass}>IBAN</label><input className={fieldClass} value={editing.iban || ""} onChange={e => setEditing({ ...editing, iban: e.target.value })} /></div>
                <div><label className={labelClass}>BIC / Swift</label><input className={fieldClass} value={editing.bicSwift || ""} onChange={e => setEditing({ ...editing, bicSwift: e.target.value })} /></div>
                <div><label className={labelClass}>Account Number</label><input className={fieldClass} value={editing.accountNumber || ""} onChange={e => setEditing({ ...editing, accountNumber: e.target.value })} /></div>
                <div><label className={labelClass}>Wise Email</label><input className={fieldClass} value={editing.wiseEmail || ""} onChange={e => setEditing({ ...editing, wiseEmail: e.target.value })} /></div>
                <div><label className={labelClass}>Revolut</label><input className={fieldClass} value={editing.revolutHandle || ""} onChange={e => setEditing({ ...editing, revolutHandle: e.target.value })} /></div>
                <div><label className={labelClass}>PayPal Email</label><input className={fieldClass} value={editing.paypalEmail || ""} onChange={e => setEditing({ ...editing, paypalEmail: e.target.value })} /></div>
              </div>
            </div>
            {albums.length > 0 && (
              <div className="sm:col-span-2">
                <label className={labelClass}>Linked Albums</label>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-secondary/40 divide-y divide-border/50">
                  {albums.map(album => {
                    const linked = (editing.albumIds || []).includes(album.id);
                    return (
                      <label key={album.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-secondary/70">
                        <input
                          type="checkbox"
                          checked={linked}
                          onChange={event => {
                            const current = editing.albumIds || [];
                            setEditing({
                              ...editing,
                              albumIds: event.target.checked
                                ? Array.from(new Set([...current, album.id]))
                                : current.filter(id => id !== album.id),
                            });
                          }}
                          className="accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-body text-foreground truncate">{album.title}</span>
                          <span className="block text-[10px] font-body text-muted-foreground truncate">{album.clientName || album.clientEmail || `${album.photoCount || album.photos?.length || 0} photos`}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] font-body text-muted-foreground/60 mt-1">Explicit links appear in the client timeline even when names or emails do not match.</p>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea className={fieldClass} rows={2} value={editing.notes || ""} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Internal notes" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} className="font-body text-sm gap-1.5"><Save className="w-4 h-4" />Save</Button>
            <Button variant="outline" onClick={() => setEditing(null)} className="font-body text-sm gap-1.5"><X className="w-4 h-4" />Cancel</Button>
          </div>
        </div>
      )}

      {/* Search */}
      {contacts.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            className="w-full pl-9 pr-3 py-2 bg-secondary border border-border text-foreground font-body text-sm rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
            placeholder="Search contacts…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* Contact list */}
      {contacts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-body text-sm">No contacts yet</p>
          <p className="font-body text-xs text-muted-foreground/60 mt-1">Add clients here so you can quickly bill them on invoices.</p>
          <Button onClick={() => setEditing(emptyContact())} variant="outline" className="mt-4 gap-2 font-body text-sm">
            <Plus className="w-4 h-4" /> Add First Contact
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => {
            const cBookings = bookings.filter(b => contactMatchesClient(c, b.clientName, b.clientEmail));
            const cInvoices = invoices.filter(i => contactMatchesClient(c, i.to?.name, i.to?.email));
            const cAlbumIds = new Set(c.albumIds || []);
            const cAlbums = albums.filter(a => cAlbumIds.has(a.id) || contactMatchesClient(c, a.clientName, a.clientEmail));
            const cTotals = Object.entries(cInvoices.reduce<Record<string, number>>((totals, invoice) => {
              const currency = invoiceCurrency(invoice);
              totals[currency] = (totals[currency] || 0) + calcInvTotal(invoice);
              return totals;
            }, {}));
            const isExpanded = expandedContactId === c.id;
            const sortedBookings = [...cBookings].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            const timeline = buildClientTimeline(c, bookings, invoices, albums);
            return (
            <div key={c.id} className="glass-panel rounded-xl overflow-hidden">
              {/* ── Header row ── */}
              <div
                className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-secondary/20 transition-colors"
                onClick={() => setExpandedContactId(isExpanded ? null : c.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm text-foreground font-medium truncate">{c.name}{c.company ? <span className="text-muted-foreground font-normal"> · {c.company}</span> : null}</p>
                  <p className="font-body text-xs text-muted-foreground truncate">{[c.email, c.phone].filter(Boolean).join(" · ")}</p>
                  {c.abn && <p className="font-body text-[10px] text-muted-foreground/60">ABN: {c.abn}</p>}
                  {(c.taxNumber || c.vatId || c.iban || c.wiseEmail || c.revolutHandle || c.paypalEmail) && (
                    <p className="font-body text-[10px] text-primary/70">
                      {[c.vatId ? `VAT ${c.vatId}` : "", c.taxNumber ? `Tax ${c.taxNumber}` : "", c.paymentProvider ? c.paymentProvider.toUpperCase() : ""].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
                  <div className="flex items-center gap-1 text-[10px] font-body text-muted-foreground">
                    <span className="px-2 py-0.5 rounded-full bg-secondary/60 border border-border/60">{cBookings.length} booking{cBookings.length !== 1 ? "s" : ""}</span>
                    <span className="px-2 py-0.5 rounded-full bg-secondary/60 border border-border/60">{cInvoices.length} invoice{cInvoices.length !== 1 ? "s" : ""}</span>
                    <span className="px-2 py-0.5 rounded-full bg-secondary/60 border border-border/60">{cAlbums.length} album{cAlbums.length !== 1 ? "s" : ""}</span>
                    {cTotals.map(([currency, total]) => <span key={currency} className="px-2 py-0.5 rounded-full bg-secondary/60 border border-border/60">{formatInvMoney({ currency }, total)}</span>)}
                  </div>
                  <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setEditing({ ...c })} className="p-2 rounded hover:bg-secondary text-muted-foreground/60 hover:text-foreground transition-colors"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(c.id)} className="p-2 rounded hover:bg-red-500/10 text-muted-foreground/60 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                </div>
              </div>
              {/* ── Expanded booking history ── */}
              {isExpanded && (
                <div className="border-t border-border/40 px-4 pb-3 pt-2">
                  {sortedBookings.length === 0 ? (
                    <p className="text-[11px] font-body text-muted-foreground/60 py-1">No bookings found for this contact.</p>
                  ) : (
                    <div className="space-y-1.5 mt-1">
                      {sortedBookings.map(b => {
                        const statusColor: Record<string, string> = {
                          confirmed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
                          pending: "bg-amber-500/15 text-amber-400 border-amber-500/20",
                          completed: "bg-blue-500/15 text-blue-400 border-blue-500/20",
                          cancelled: "bg-red-500/15 text-red-400 border-red-500/20",
                        };
                        const sColor = statusColor[b.status] || "bg-secondary/60 text-muted-foreground border-border/60";
                        const dateStr = b.date ? new Date(b.date + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";
                        return (
                          <div key={b.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/20 last:border-0">
                            <div className="min-w-0 flex-1">
                              <p className="font-body text-xs text-foreground font-medium truncate">{b.type || b.eventTypeId}</p>
                              <p className="font-body text-[10px] text-muted-foreground">{dateStr}{b.time ? ` at ${b.time}` : ""}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {b.paymentAmount != null && (
                                <span className="font-body text-[10px] text-muted-foreground">${b.paymentAmount.toFixed(2)}</span>
                              )}
                              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-body font-medium border ${sColor}`}>{b.status}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {c.notes && (
                    <p className="font-body text-[10px] text-muted-foreground/70 mt-2 pt-2 border-t border-border/20 italic">{c.notes}</p>
                  )}
                  {cAlbums.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/20">
                      <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-2">Albums</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {cAlbums.map(album => (
                          <button
                            key={album.id}
                            type="button"
                            onClick={async () => {
                              if (await ensurePublicShareReady(album, "open this gallery")) {
                                window.open(`/gallery/${album.slug || album.id}`, "_blank", "noopener,noreferrer");
                              }
                            }}
                            className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 hover:border-primary/40 transition-colors"
                          >
                            <p className="text-xs font-body text-foreground truncate">{album.title}</p>
                            <p className="text-[10px] font-body text-muted-foreground truncate">{album.photoCount || album.photos?.length || 0} photo{(album.photoCount || album.photos?.length || 0) !== 1 ? "s" : ""} · open gallery</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-border/20">
                    <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-2">Client Timeline</p>
                    {timeline.length === 0 ? (
                      <p className="text-[11px] font-body text-muted-foreground/60">No timeline activity found yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {timeline.map(item => {
                          const Icon =
                            item.type === "booking" ? Calendar :
                            item.type === "invoice" ? Receipt :
                            item.type === "album" ? Image :
                            item.type === "download" ? Download :
                            Mail;
                          const dateLabel = new Date(item.at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
                          return (
                            <div key={item.id} className="flex gap-2">
                              <span className="w-7 h-7 rounded-full bg-secondary border border-border/50 flex items-center justify-center shrink-0">
                                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-body text-foreground truncate">{item.title}</p>
                                  <span className="text-[10px] font-body text-muted-foreground/60 shrink-0">{dateLabel}</span>
                                </div>
                                <p className="text-[10px] font-body text-muted-foreground truncate">{item.detail}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            );
          })}
          {filtered.length === 0 && searchQuery && (
            <p className="text-center py-8 text-sm font-body text-muted-foreground">No contacts match "{searchQuery}"</p>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─── Settings ────────────────────────────────────────

export { EnquiriesView, ProfileView, ContactsView };

