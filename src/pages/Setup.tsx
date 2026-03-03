import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, ArrowRight, ArrowLeft, Plus, Trash2, Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  completeSetup, setAdminCredentials, setProfile, addEventType,
  setSettings, getSettings, hashPassword, login,
} from "@/lib/storage";
import type {
  EventType, QuestionField, AvailabilitySlot, AppSettings, BankTransferSettings,
} from "@/lib/types";

type SetupStep = "welcome" | "profile" | "event-type" | "payments" | "done";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function generateId() {
  return `et-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function Setup({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<SetupStep>("welcome");

  // Welcome
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Profile
  const [name, setName] = useState("Zac M Photos");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [timezone] = useState("Australia/Sydney");

  // Event Type
  const [etTitle, setEtTitle] = useState("");
  const [etDesc, setEtDesc] = useState("");
  const [etDurations, setEtDurations] = useState<number[]>([30]);
  const [etPrice, setEtPrice] = useState(0);
  const [etRequiresConfirmation, setEtRequiresConfirmation] = useState(false);
  const [etQuestions, setEtQuestions] = useState<QuestionField[]>([
    { id: "q1", label: "Name", type: "text", required: true, placeholder: "Your full name" },
    { id: "q2", label: "Email", type: "text", required: true, placeholder: "you@example.com" },
  ]);
  const [etRecurring, setEtRecurring] = useState<AvailabilitySlot[]>([
    { day: 1, startTime: "09:00", endTime: "17:00" },
    { day: 2, startTime: "09:00", endTime: "17:00" },
    { day: 3, startTime: "09:00", endTime: "17:00" },
    { day: 4, startTime: "09:00", endTime: "17:00" },
    { day: 5, startTime: "09:00", endTime: "17:00" },
  ]);

  // Payments
  const [bankEnabled, setBankEnabled] = useState(false);
  const [bankSettings, setBankSettings] = useState<BankTransferSettings>({
    enabled: false, accountName: "", bsb: "", accountNumber: "",
    payId: "", payIdType: "email",
    instructions: "Please include your booking reference in the transfer description.",
  });

  const [durationInput, setDurationInput] = useState("");

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleWelcomeNext = async () => {
    if (!username.trim() || !password.trim()) {
      toast.error("Username and password are required");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    try {
      const hash = await hashPassword(password);
      setAdminCredentials({ username: username.trim(), passwordHash: hash });
      setStep("profile");
    } catch (err) {
      console.error("Setup hash error:", err);
      toast.error("Failed to create account. Please try again.");
    }
  };

  const handleProfileNext = () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setProfile({ name: name.trim(), bio: bio.trim(), avatar, timezone });
    setStep("event-type");
  };

  const handleEventTypeNext = () => {
    if (!etTitle.trim()) {
      toast.error("Event type title is required");
      return;
    }
    if (etDurations.length === 0) {
      toast.error("Add at least one duration");
      return;
    }
    if (etRecurring.length === 0) {
      toast.error("Set at least one day of availability");
      return;
    }
    const et: EventType = {
      id: generateId(),
      title: etTitle.trim(),
      description: etDesc.trim(),
      durations: etDurations,
      color: "primary",
      price: etPrice,
      active: true,
      requiresConfirmation: etRequiresConfirmation,
      questions: etQuestions,
      availability: {
        recurring: etRecurring,
        specificDates: [],
        blockedDates: [],
      },
    };
    addEventType(et);
    setStep("payments");
  };

  const handlePaymentsFinish = () => {
    const settings: AppSettings = {
      ...getSettings(),
      bankTransfer: { ...bankSettings, enabled: bankEnabled },
    };
    setSettings(settings);
    completeSetup();
    login();
    setStep("done");
  };

  const addDuration = () => {
    const val = parseInt(durationInput);
    if (!val || val <= 0) return;
    if (etDurations.includes(val)) {
      toast.error("Duration already exists");
      return;
    }
    setEtDurations([...etDurations, val].sort((a, b) => a - b));
    setDurationInput("");
  };

  const addQuestion = () => {
    setEtQuestions([
      ...etQuestions,
      { id: `q${Date.now()}`, label: "", type: "text", required: false, placeholder: "" },
    ]);
  };

  const updateQuestion = (idx: number, updates: Partial<QuestionField>) => {
    setEtQuestions(etQuestions.map((q, i) => (i === idx ? { ...q, ...updates } : q)));
  };

  const removeQuestion = (idx: number) => {
    setEtQuestions(etQuestions.filter((_, i) => i !== idx));
  };

  const toggleDay = (day: number) => {
    const exists = etRecurring.find((s) => s.day === day);
    if (exists) {
      setEtRecurring(etRecurring.filter((s) => s.day !== day));
    } else {
      setEtRecurring([...etRecurring, { day, startTime: "09:00", endTime: "17:00" }].sort((a, b) => a.day - b.day));
    }
  };

  const updateDayTime = (day: number, field: "startTime" | "endTime", value: string) => {
    setEtRecurring(etRecurring.map((s) => (s.day === day ? { ...s, [field]: value } : s)));
  };

  const slideIn = { initial: { opacity: 0, x: 40 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -40 } };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="w-full max-w-lg">
        <AnimatePresence mode="wait">
          {/* ─── Welcome ─── */}
          {step === "welcome" && (
            <motion.div key="welcome" {...slideIn} className="space-y-6">
              <div className="text-center mb-8">
                <Camera className="w-10 h-10 text-primary mx-auto mb-4" />
                <h1 className="font-display text-3xl text-foreground">Welcome to Zacmphotos</h1>
                <p className="text-sm font-body text-muted-foreground mt-2">Let's set up your admin account.</p>
              </div>
              <div className="glass-panel rounded-xl p-6 space-y-4">
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Username</label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Password</label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Confirm Password</label>
                  <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••" className="bg-secondary border-border text-foreground font-body" />
                </div>
                <Button onClick={handleWelcomeNext} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                  Continue <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ─── Profile ─── */}
          {step === "profile" && (
            <motion.div key="profile" {...slideIn} className="space-y-6">
              <div className="text-center mb-4">
                <h2 className="font-display text-2xl text-foreground">Your Profile</h2>
                <p className="text-sm font-body text-muted-foreground mt-1">This is what clients see on the booking page.</p>
              </div>
              <div className="glass-panel rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-4">
                  <label className="cursor-pointer">
                    <div className="w-16 h-16 rounded-full bg-secondary border-2 border-dashed border-border flex items-center justify-center overflow-hidden">
                      {avatar ? (
                        <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <Upload className="w-5 h-5 text-muted-foreground/50" />
                      )}
                    </div>
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                  </label>
                  <div className="text-xs font-body text-muted-foreground">Click to upload avatar</div>
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Display Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Bio</label>
                  <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A short bio for your booking page..." className="bg-secondary border-border text-foreground font-body min-h-[60px]" />
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep("welcome")} className="font-body text-xs border-border text-foreground gap-2">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </Button>
                  <Button onClick={handleProfileNext} className="flex-1 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                    Continue <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ─── Event Type ─── */}
          {step === "event-type" && (
            <motion.div key="event-type" {...slideIn} className="space-y-6">
              <div className="text-center mb-4">
                <h2 className="font-display text-2xl text-foreground">Your First Event Type</h2>
                <p className="text-sm font-body text-muted-foreground mt-1">You can add more later from the admin panel.</p>
              </div>
              <div className="glass-panel rounded-xl p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Title *</label>
                  <Input value={etTitle} onChange={(e) => setEtTitle(e.target.value)} placeholder="e.g. Portrait Session" className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Description</label>
                  <Textarea value={etDesc} onChange={(e) => setEtDesc(e.target.value)} placeholder="Describe this event type..." className="bg-secondary border-border text-foreground font-body min-h-[60px]" />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Price ($)</label>
                  <Input type="number" value={etPrice} onChange={(e) => setEtPrice(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body w-32" />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Durations (minutes)</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {etDurations.map((d) => (
                      <span key={d} className="inline-flex items-center gap-1 text-xs font-body bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                        {d}m
                        <button onClick={() => setEtDurations(etDurations.filter((x) => x !== d))} className="hover:text-destructive">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input type="number" value={durationInput} onChange={(e) => setDurationInput(e.target.value)} placeholder="e.g. 25" className="bg-secondary border-border text-foreground font-body w-24" onKeyDown={(e) => e.key === "Enter" && addDuration()} />
                    <Button variant="outline" size="sm" onClick={addDuration} className="font-body text-xs border-border text-foreground">Add</Button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-body text-muted-foreground">Requires Confirmation</span>
                  <Switch checked={etRequiresConfirmation} onCheckedChange={setEtRequiresConfirmation} />
                </div>

                {/* Availability */}
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Weekly Availability</label>
                  <div className="space-y-2">
                    {DAY_NAMES.map((dayName, i) => {
                      const slot = etRecurring.find((s) => s.day === i);
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <Switch checked={!!slot} onCheckedChange={() => toggleDay(i)} />
                          <span className="text-sm font-body text-foreground w-24">{dayName}</span>
                          {slot ? (
                            <div className="flex items-center gap-2">
                              <Input type="time" value={slot.startTime} onChange={(e) => updateDayTime(i, "startTime", e.target.value)} className="bg-secondary border-border text-foreground font-body w-28 text-xs" />
                              <span className="text-xs text-muted-foreground">—</span>
                              <Input type="time" value={slot.endTime} onChange={(e) => updateDayTime(i, "endTime", e.target.value)} className="bg-secondary border-border text-foreground font-body w-28 text-xs" />
                            </div>
                          ) : (
                            <span className="text-xs font-body text-muted-foreground/50">Unavailable</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Questions */}
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Booking Questions</label>
                  <div className="space-y-3">
                    {etQuestions.map((q, idx) => (
                      <div key={q.id} className="p-3 rounded-lg bg-secondary/50 border border-border/50 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input value={q.label} onChange={(e) => updateQuestion(idx, { label: e.target.value })} placeholder="Question label" className="bg-secondary border-border text-foreground font-body text-sm flex-1" />
                          <select value={q.type} onChange={(e) => updateQuestion(idx, { type: e.target.value as QuestionField["type"] })} className="bg-secondary border border-border text-foreground font-body text-xs rounded-md px-2 py-2">
                            <option value="text">Text</option>
                            <option value="textarea">Long Text</option>
                            <option value="select">Select</option>
                            <option value="boolean">Yes/No</option>
                            <option value="image-upload">Image Upload</option>
                          </select>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeQuestion(idx)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-xs font-body text-muted-foreground cursor-pointer">
                            <Switch checked={q.required} onCheckedChange={(v) => updateQuestion(idx, { required: v })} />
                            Required
                          </label>
                          <Input value={q.placeholder || ""} onChange={(e) => updateQuestion(idx, { placeholder: e.target.value })} placeholder="Placeholder text" className="bg-secondary border-border text-foreground font-body text-xs flex-1" />
                        </div>
                        {q.type === "select" && (
                          <Input value={q.options?.join(", ") || ""} onChange={(e) => updateQuestion(idx, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Options (comma separated)" className="bg-secondary border-border text-foreground font-body text-xs" />
                        )}
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={addQuestion} className="mt-3 font-body text-xs border-border text-foreground gap-1">
                    <Plus className="w-3.5 h-3.5" /> Add Question
                  </Button>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("profile")} className="font-body text-xs border-border text-foreground gap-2">
                  <ArrowLeft className="w-4 h-4" /> Back
                </Button>
                <Button onClick={handleEventTypeNext} className="flex-1 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                  Continue <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ─── Payments ─── */}
          {step === "payments" && (
            <motion.div key="payments" {...slideIn} className="space-y-6">
              <div className="text-center mb-4">
                <h2 className="font-display text-2xl text-foreground">Payment Settings</h2>
                <p className="text-sm font-body text-muted-foreground mt-1">Configure how clients pay. You can change this later.</p>
              </div>
              <div className="glass-panel rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-body text-foreground">Enable Bank Transfer / PayID</span>
                  <Switch checked={bankEnabled} onCheckedChange={setBankEnabled} />
                </div>
                {bankEnabled && (
                  <div className="space-y-3 pt-3 border-t border-border/50">
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Account Name</label>
                      <Input value={bankSettings.accountName} onChange={(e) => setBankSettings({ ...bankSettings, accountName: e.target.value })} className="bg-secondary border-border text-foreground font-body" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">BSB</label>
                        <Input value={bankSettings.bsb} onChange={(e) => setBankSettings({ ...bankSettings, bsb: e.target.value })} className="bg-secondary border-border text-foreground font-body" />
                      </div>
                      <div>
                        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Account Number</label>
                        <Input value={bankSettings.accountNumber} onChange={(e) => setBankSettings({ ...bankSettings, accountNumber: e.target.value })} className="bg-secondary border-border text-foreground font-body" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">PayID</label>
                      <Input value={bankSettings.payId} onChange={(e) => setBankSettings({ ...bankSettings, payId: e.target.value })} className="bg-secondary border-border text-foreground font-body" />
                    </div>
                  </div>
                )}
                <p className="text-xs font-body text-muted-foreground/50">
                  Stripe integration requires a backend service. Configure via Docker env vars later.
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("event-type")} className="font-body text-xs border-border text-foreground gap-2">
                  <ArrowLeft className="w-4 h-4" /> Back
                </Button>
                <Button onClick={handlePaymentsFinish} className="flex-1 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                  Finish Setup <CheckCircle2 className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ─── Done ─── */}
          {step === "done" && (
            <motion.div key="done" {...slideIn} className="text-center space-y-6">
              <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto" />
              <h2 className="font-display text-3xl text-foreground">You're All Set!</h2>
              <p className="text-sm font-body text-muted-foreground">Your booking page is ready. You can manage everything from the admin panel.</p>
              <Button onClick={onComplete} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                Go to Admin Panel <ArrowRight className="w-4 h-4" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
