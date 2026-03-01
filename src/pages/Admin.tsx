import { useState } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Images, Calendar, Settings, Plus, Upload,
  Eye, Trash2, Edit, Link as LinkIcon, Users, DollarSign, ImageIcon,
  Clock, Building2, CreditCard
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Header from "@/components/Header";
import {
  sampleAlbums, sampleBookings, sampleEventTypes,
  defaultAvailability, defaultBankTransfer,
  type EventType, type WatermarkPosition
} from "@/lib/mock-data";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

type Tab = "dashboard" | "albums" | "bookings" | "event-types" | "settings";

export default function Admin() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  const tabs = [
    { id: "dashboard" as Tab, label: "Dashboard", icon: LayoutDashboard },
    { id: "albums" as Tab, label: "Albums", icon: Images },
    { id: "bookings" as Tab, label: "Bookings", icon: Calendar },
    { id: "event-types" as Tab, label: "Event Types", icon: Clock },
    { id: "settings" as Tab, label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="pt-20 flex">
        <aside className="w-56 fixed left-0 top-16 bottom-0 border-r border-border bg-card/50 p-4 hidden lg:block">
          <p className="text-[10px] font-body tracking-[0.3em] uppercase text-muted-foreground mb-4 px-3">Admin Panel</p>
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body transition-all ${
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="lg:hidden fixed top-16 left-0 right-0 z-30 bg-card/95 backdrop-blur-sm border-b border-border flex overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-body tracking-wider uppercase whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "text-primary border-primary"
                  : "text-muted-foreground border-transparent"
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        <main className="flex-1 lg:ml-56 p-6 lg:p-8 mt-12 lg:mt-0">
          {activeTab === "dashboard" && <DashboardView />}
          {activeTab === "albums" && <AlbumsView />}
          {activeTab === "bookings" && <BookingsView />}
          {activeTab === "event-types" && <EventTypesView />}
          {activeTab === "settings" && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

function DashboardView() {
  const stats = [
    { label: "Total Albums", value: sampleAlbums.length, icon: Images, color: "text-primary" },
    { label: "Total Photos", value: sampleAlbums.reduce((s, a) => s + a.photoCount, 0), icon: ImageIcon, color: "text-primary" },
    { label: "Active Bookings", value: sampleBookings.filter((b) => b.status === "confirmed").length, icon: Users, color: "text-primary" },
    { label: "Revenue", value: "$2,450", icon: DollarSign, color: "text-primary" },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Dashboard</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-panel rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <p className="font-display text-2xl text-foreground">{stat.value}</p>
            <p className="text-xs font-body text-muted-foreground tracking-wider uppercase">{stat.label}</p>
          </div>
        ))}
      </div>

      <h3 className="font-display text-lg text-foreground mb-4">Recent Bookings</h3>
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Client</th>
                <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Type</th>
                <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Date</th>
                <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Status</th>
                <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Gallery</th>
              </tr>
            </thead>
            <tbody>
              {sampleBookings.map((booking) => (
                <tr key={booking.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="p-4 text-sm font-body text-foreground">{booking.clientName}</td>
                  <td className="p-4 text-sm font-body text-muted-foreground">{booking.type}</td>
                  <td className="p-4 text-sm font-body text-muted-foreground">{booking.date}</td>
                  <td className="p-4">
                    <span className={`text-xs font-body px-2.5 py-1 rounded-full ${
                      booking.status === "completed" ? "bg-green-500/10 text-green-400" :
                      booking.status === "confirmed" ? "bg-primary/10 text-primary" :
                      booking.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
                      "bg-destructive/10 text-destructive"
                    }`}>
                      {booking.status}
                    </span>
                  </td>
                  <td className="p-4">
                    {booking.albumId ? (
                      <LinkIcon className="w-4 h-4 text-primary" />
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

function AlbumsView() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Albums</h2>
        <Button size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase" onClick={() => toast.info("Connect Cloud to enable album creation")}>
          <Plus className="w-4 h-4" /> New Album
        </Button>
      </div>

      <div className="space-y-3">
        {sampleAlbums.map((album) => (
          <div key={album.id} className="glass-panel rounded-xl p-4 flex items-center gap-4">
            <img src={album.coverImage} alt={album.title} className="w-16 h-16 rounded-lg object-cover" />
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-base text-foreground truncate">{album.title}</h3>
              <p className="text-xs font-body text-muted-foreground">
                {album.photoCount} photos · {album.date}
                {album.accessCode && <span className="text-primary ml-2">Code: {album.accessCode}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-body">{album.freeDownloads} free</span>
              <span className="text-border">·</span>
              <span className="font-body">${album.pricePerPhoto}/photo</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                <Eye className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                <Upload className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                <Edit className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function BookingsView() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Bookings</h2>
      </div>

      <div className="space-y-3">
        {sampleBookings.map((booking) => (
          <div key={booking.id} className="glass-panel rounded-xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-body text-foreground font-medium">{booking.clientName}</h3>
              <p className="text-xs font-body text-muted-foreground">{booking.type} · {booking.date} at {booking.time}</p>
            </div>
            <span className={`text-xs font-body px-2.5 py-1 rounded-full ${
              booking.status === "completed" ? "bg-green-500/10 text-green-400" :
              booking.status === "confirmed" ? "bg-primary/10 text-primary" :
              booking.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
              "bg-destructive/10 text-destructive"
            }`}>
              {booking.status}
            </span>
            {booking.albumId ? (
              <Button variant="ghost" size="sm" className="gap-1 text-xs text-primary" onClick={() => toast.info(`Gallery: ${booking.albumId}`)}>
                <LinkIcon className="w-3.5 h-3.5" /> Gallery
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground" onClick={() => toast.info("Connect Cloud to link galleries")}>
                <Plus className="w-3.5 h-3.5" /> Link
              </Button>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function EventTypesView() {
  const [eventTypes, setEventTypes] = useState<EventType[]>(sampleEventTypes);

  const toggleActive = (id: string) => {
    setEventTypes((prev) =>
      prev.map((et) => (et.id === id ? { ...et, active: !et.active } : et))
    );
    toast.success("Event type updated");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Event Types</h2>
        <Button size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase" onClick={() => toast.info("Connect Cloud to create event types")}>
          <Plus className="w-4 h-4" /> New Event Type
        </Button>
      </div>

      <div className="space-y-3">
        {eventTypes.map((et) => (
          <div key={et.id} className={`glass-panel rounded-xl p-5 border transition-all ${et.active ? "border-border/50" : "border-border/20 opacity-60"}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <div className={`w-1.5 h-12 rounded-full mt-0.5 bg-primary ${!et.active ? "opacity-30" : ""}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-display text-base text-foreground">{et.title}</h3>
                    <span className="text-xs font-body text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {et.duration >= 60 ? `${Math.floor(et.duration / 60)}h${et.duration % 60 > 0 ? ` ${et.duration % 60}m` : ""}` : `${et.duration}m`}
                    </span>
                  </div>
                  <p className="text-sm font-body text-muted-foreground mt-1">{et.description}</p>
                  <p className="text-sm font-body text-primary font-medium mt-2">${et.price}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={et.active} onCheckedChange={() => toggleActive(et.id)} />
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Edit className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Availability Schedule */}
      <div className="mt-10">
        <h3 className="font-display text-lg text-foreground mb-4">Availability Schedule</h3>
        <div className="glass-panel rounded-xl p-5 space-y-3">
          {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((dayName, dayIndex) => {
            const avail = defaultAvailability.find((a) => a.day === dayIndex);
            return (
              <div key={dayName} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <span className="text-sm font-body text-foreground w-28">{dayName}</span>
                {avail ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-body text-primary">{avail.startTime}</span>
                    <span className="text-xs text-muted-foreground">—</span>
                    <span className="text-sm font-body text-primary">{avail.endTime}</span>
                  </div>
                ) : (
                  <span className="text-sm font-body text-muted-foreground/50">Unavailable</span>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                  <Edit className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function SettingsView() {
  const [watermarkPos, setWatermarkPos] = useState<WatermarkPosition>("center");
  const [bankEnabled, setBankEnabled] = useState(defaultBankTransfer.enabled);

  const watermarkOptions: { value: WatermarkPosition; label: string }[] = [
    { value: "center", label: "Center" },
    { value: "top-left", label: "Top Left" },
    { value: "top-right", label: "Top Right" },
    { value: "bottom-left", label: "Bottom Left" },
    { value: "bottom-right", label: "Bottom Right" },
    { value: "tiled", label: "Tiled" },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Settings</h2>

      <div className="space-y-6 max-w-lg">
        {/* Watermark Settings */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground">Watermark</h3>
          <p className="text-xs font-body text-muted-foreground">Upload your logo and configure watermark positioning.</p>
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 rounded-lg bg-secondary border-2 border-dashed border-border flex items-center justify-center">
              <Upload className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <Button variant="outline" size="sm" className="font-body text-xs border-border text-foreground" onClick={() => toast.info("Connect Cloud to enable logo upload")}>
              Upload Logo
            </Button>
          </div>

          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">
              Watermark Position
            </label>
            <div className="grid grid-cols-3 gap-2">
              {watermarkOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setWatermarkPos(opt.value); toast.success(`Watermark position: ${opt.label}`); }}
                  className={`text-xs font-body py-2.5 px-3 rounded-lg border transition-all ${
                    watermarkPos === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Watermark Text (fallback)</label>
            <Input defaultValue="LUMIÈRE" className="bg-secondary border-border text-foreground font-body" />
          </div>
        </div>

        {/* Default Album Settings */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground">Default Album Settings</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Free Downloads per Album</label>
              <Input type="number" defaultValue={5} className="bg-secondary border-border text-foreground font-body w-32" />
            </div>
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Price per Photo ($)</label>
              <Input type="number" defaultValue={12} className="bg-secondary border-border text-foreground font-body w-32" />
            </div>
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Full Album Price ($)</label>
              <Input type="number" defaultValue={299} className="bg-secondary border-border text-foreground font-body w-32" />
            </div>
          </div>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase" onClick={() => toast.success("Settings saved!")}>
            Save Settings
          </Button>
        </div>

        {/* Payment Settings */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            Payment Methods
          </h3>

          {/* Stripe */}
          <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-body text-foreground font-medium">Stripe</span>
              <span className="text-xs font-body text-muted-foreground/50">Not connected</span>
            </div>
            <p className="text-xs font-body text-muted-foreground mb-3">Accept credit/debit card payments.</p>
            <Button variant="outline" size="sm" className="font-body text-xs border-border text-foreground" onClick={() => toast.info("Stripe integration available — ask to enable it!")}>
              Connect Stripe
            </Button>
          </div>

          {/* Bank Transfer / PayID */}
          <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-body text-foreground font-medium flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Bank Transfer / PayID
              </span>
              <Switch checked={bankEnabled} onCheckedChange={(v) => { setBankEnabled(v); toast.success(v ? "Bank transfer enabled" : "Bank transfer disabled"); }} />
            </div>
            <p className="text-xs font-body text-muted-foreground mb-3">Allow clients to pay via direct bank transfer or PayID.</p>

            {bankEnabled && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-3 mt-4 pt-4 border-t border-border/50">
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Account Name</label>
                  <Input defaultValue={defaultBankTransfer.accountName} placeholder="Business Name Pty Ltd" className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">BSB</label>
                    <Input defaultValue={defaultBankTransfer.bsb} placeholder="000-000" className="bg-secondary border-border text-foreground font-body" />
                  </div>
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Account Number</label>
                    <Input defaultValue={defaultBankTransfer.accountNumber} placeholder="12345678" className="bg-secondary border-border text-foreground font-body" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">PayID</label>
                  <div className="flex gap-2">
                    <select className="bg-secondary border border-border text-foreground font-body text-xs rounded-lg px-3 py-2">
                      <option value="email">Email</option>
                      <option value="phone">Phone</option>
                      <option value="abn">ABN</option>
                    </select>
                    <Input defaultValue={defaultBankTransfer.payId} placeholder="you@email.com" className="bg-secondary border-border text-foreground font-body flex-1" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Payment Instructions</label>
                  <Textarea defaultValue={defaultBankTransfer.instructions} className="bg-secondary border-border text-foreground font-body min-h-[60px]" />
                </div>
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase" onClick={() => toast.success("Bank transfer settings saved!")}>
                  Save Payment Settings
                </Button>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
