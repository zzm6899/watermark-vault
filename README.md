# PhotoFlow — Cosplay Convention Photography Booking System

> **Your complete photography business, in one self-hosted app.**

PhotoFlow is an all-in-one platform built for cosplay convention photographers. It handles bookings, gallery delivery, watermarking, invoicing, expense tracking, and client proofing — without monthly SaaS fees. Deploy it on your own server, keep 100% of your revenue.

---

## Table of Contents

1. [What is PhotoFlow?](#what-is-photoflow)
2. [Quick Start (Docker)](#quick-start-docker)
3. [First-Time Setup Wizard](#first-time-setup-wizard)
4. [Admin Panel Overview](#admin-panel-overview)
5. [Bookings & Scheduling](#bookings--scheduling)
6. [Gallery & Delivery](#gallery--delivery)
7. [Finance & Payments](#finance--payments)
8. [Workflow & Automation](#workflow--automation)
9. [Mobile Capture App](#mobile-capture-app)
10. [iCal / Calendar Feed](#ical--calendar-feed)
11. [PWA Push Notifications](#pwa-push-notifications)
12. [Multi-Tenant (Multiple Photographers)](#multi-tenant-multiple-photographers)
13. [Integrations](#integrations)
14. [Configuration Reference](#configuration-reference)
15. [Android APK Build](#android-apk-build)
16. [Troubleshooting](#troubleshooting)

---

## What is PhotoFlow?

PhotoFlow is designed for photographers who shoot cosplay conventions, events, and portrait sessions. It solves three core problems:

**Taking bookings at events.** Clients scan a QR code to your booking page, pick a time slot, pay a deposit (or full amount) via Stripe or bank transfer, and get a confirmation email — all without you needing to manage a spreadsheet.

**Delivering galleries.** After the shoot you upload photos, apply watermarks for proofing, let the client select favourites, then deliver the final gallery with one click. Watermarks are applied server-side using Sharp, so the originals stay pristine.

**Running the business.** Invoices, payment tracking, expenses, quotes, and source analytics are built in so you know where your revenue comes from (Instagram? TikTok? Repeat clients?) without needing separate accounting software.

---

## Quick Start (Docker)

```yaml
# docker-compose.yml
services:
  photoflow:
    image: ghcr.io/yourhandle/photoflow:latest
    ports:
      - "5066:5066"
    volumes:
      - ./data:/data
    environment:
      - SUPER_ADMIN_USERNAME=admin
      - SUPER_ADMIN_PASSWORD=your-secure-password
      # Optional — skip the setup wizard:
      # - SMTP_HOST=smtp.gmail.com
      # - SMTP_PORT=587
      # - SMTP_USER=you@gmail.com
      # - SMTP_PASS=app-password
      # - STRIPE_SECRET_KEY=sk_live_...
      # - STRIPE_PUBLISHABLE_KEY=pk_live_...
      # - STRIPE_WEBHOOK_SECRET=whsec_...
```

```bash
docker compose up -d
# Visit http://localhost:5066
```

All data (database + uploaded photos) is stored in `./data`. Back up this folder to keep your data safe.

---

## First-Time Setup Wizard

On first visit to `/admin` you'll see a four-step setup wizard:

1. **Profile** — your display name, bio, and timezone. This appears on your public booking page.
2. **Watermark** — upload a logo PNG or set a text watermark, position, and opacity.
3. **Payments** — optionally connect Stripe (for card payments) and/or bank transfer details.
4. **Password** — set your admin password.

You can change any of these later from the Settings tab.

---

## Admin Panel Overview

The admin panel has these tabs:

| Tab | What it does |
|-----|-------------|
| **Dashboard** | At-a-glance stats: bookings today, pending payments, gallery counts, recent activity |
| **Bookings** | All bookings — create, edit, confirm, cancel, send reminders, track tasks |
| **Events** | Manage your event types (session packages) with pricing, availability, and questions |
| **Albums** | Gallery management — upload photos, watermark, proof, deliver |
| **Photos** | Cross-album photo library view |
| **Finance** | Revenue summary, payment history, expense tracker, quotes/estimates |
| **Invoices** | Create and send invoices with Stripe or bank transfer payment links |
| **Contacts** | Address book for recurring clients |
| **Enquiries** | Inbound enquiries from your booking page (when enquiry mode is enabled) |
| **Profile** | Your public-facing name, bio, and avatar |
| **Settings** | Watermark, booking settings, FTP, email automation, iCal feed, tags |
| **Storage** | Disk usage, cache management, preview rendering status |
| **Platform** | (Super admin only) Tenant management, license keys, platform stats |

---

## Bookings & Scheduling

### Creating an Event Type

Event types are your "session packages" — e.g. "15-Minute Cosplay Portrait" or "1-Hour Premium Session".

Go to **Events** → **New Event Type**. Key fields:

- **Title** — displayed on your booking page
- **Durations** — available session lengths (e.g. 15, 30, 60 min)
- **Price** — base price; you can set per-duration prices in the advanced settings
- **Availability** — recurring weekly slots (e.g. Saturday 10am–6pm) plus specific dates and blocked dates
- **Deposit** — optionally require a deposit (fixed or %) paid at booking time
- **Questions** — custom intake form questions (text, dropdown, yes/no, image upload, Instagram handle)
- **Requires Confirmation** — if enabled, bookings stay "pending" until you manually confirm them
- **Buffer Time** — block X minutes after each session (for changeovers / travel)
- **Max Attendees** — for group bookings (couples, groups — default 1)
- **Task Template** — automatically attach a pre-defined checklist to each booking of this type

### The Booking Page

Your public booking page is at `/` (or `/book/your-slug` in multi-tenant mode). Clients:

1. Choose a session type
2. Pick a date and time (availability is enforced automatically)
3. Fill in your custom questions
4. Pay deposit or full amount (Stripe or bank transfer)
5. Receive a confirmation email

The page has a dark elegant theme using your brand colour. It works on mobile and desktop.

### Managing Bookings

In the **Bookings** tab, each booking card shows:

- Client name, Instagram handle, session type, date/time
- Status (pending / confirmed / completed / cancelled) — change via dropdown
- Payment status — unpaid / deposit paid / paid / cash / bank transfer pending
- Source — where the booking came from (convention, Instagram, referral, etc.)

Click any booking to expand it and see:

- Contact details and Q&A answers
- Status change history timeline
- Email history (when reminders were sent, whether they were opened)
- **Task checklist** — add and tick off per-booking tasks (e.g. "Send proof gallery", "Chase payment")
- Quick actions: send payment reminder, booking reminder, custom email
- Link to create or view the associated gallery album

### Booking Source Tracking

When editing a booking, set the **Booking Source** field (Direct, Convention, Instagram, Facebook, TikTok, Referral, Returning Client, Email, Other). This feeds into the Finance analytics so you can see which channels bring the most revenue.

### Waitlist

If all slots are full, clients can join a waitlist. When a booking is cancelled you can notify waitlisted clients with a time-limited claim link from the Bookings tab.

---

## Gallery & Delivery

### Uploading Photos

In the **Albums** tab, open or create an album. Use the **Upload Photos** section to drag-and-drop or select files. Photos are stored server-side in `/data/uploads/`. Thumbnails and watermarked previews are generated automatically in the background.

### Watermarking

Configure your watermark in **Settings**:

- **Text** — your business name or social handle
- **Image** — upload a PNG logo (transparent background recommended)
- **Position** — center, corner, or tiled across the image
- **Opacity** — 5–80% (lower = subtle)
- **Size** — 10–100% of image width

Watermarks are applied on-the-fly for gallery views and baked-in for download previews.

### Proofing Workflow

Enable **Client Proofing** in Settings. Then for any album:

1. Set album status to **Proofing** and click **Start Proofing Round**
2. A link with a client token is generated — share it (or email it)
3. Client views watermarked proofs and selects favourites
4. You see their selections in the admin panel and can start editing
5. Repeat rounds as needed, then deliver finals

### Magic Link Gallery Access

Clients access galleries via a PIN-free magic link using their `clientToken`. No account needed. Each gallery can optionally require a PIN as an extra layer.

### Gallery Share Links (Expiring)

In the album editor, create **Share Links** to share a gallery with third parties (e.g. event organisers, cosplay groups) without giving them the client's access code. Each link can:

- Have a label (e.g. "For event organisers")
- Expire after a set date
- Allow or block downloads

### Photo Comments / Annotations

On the public gallery page, clients (or share link viewers) can leave comments on individual photos — useful for noting retouching requests. Comments appear in the admin panel where you can resolve them.

### Download Cart

Clients can add photos to a cart and download a ZIP of their selection. ZIP generation is handled server-side.

### One-Click Gallery Delivery

When you're ready to deliver, open the album editor and click **Deliver Gallery Now**. This:

1. Disables watermarks on all photos
2. Sets album status to "Delivered"
3. Makes the album publicly accessible
4. Sends a "Your gallery is ready" email to the client (if SMTP is configured)

---

## Finance & Payments

### Invoices

In the **Invoices** tab, create professional invoices with:

- Line items (description, quantity, unit price)
- Tax (GST or other percentage)
- Discount
- Payment methods: Stripe payment link or bank transfer instructions

Send the invoice via email. The client gets a public link where they can pay. Invoice status auto-updates from `sent` → `overdue` when the due date passes (checked every 6 hours).

### Quotes / Estimates

In the **Finance** tab, use **Quotes & Estimates** to send cost estimates before a booking is confirmed:

1. Create a quote with the client's name and line items
2. Mark it as "Sent" when you've shared the link
3. Client can accept or decline via the public share link
4. Once accepted, click **→ Invoice** to convert it to a real invoice automatically

### Expenses

Track your business costs in the **Finance** tab → **Expenses**:

- Description, amount, date, and category (equipment, travel, software, props, venue, etc.)
- Linked optionally to a booking or album
- Category breakdown shows where your money goes

### Payment Plans / Instalments

For large bookings, create an instalment plan from the booking detail view: add multiple payment milestones with due dates and amounts. The server automatically marks overdue instalments every 6 hours.

### Revenue Analytics

The Finance tab shows:

- Monthly revenue bar chart (last 12 months)
- Revenue by booking source (Instagram, convention, referral, etc.)
- Average booking value
- Booking conversion rate
- Stripe vs bank transfer breakdown

---

## Workflow & Automation

### Task Checklists

Each booking has a task checklist. You can:

- Add individual tasks directly on the booking card (click to expand)
- Create **Task Templates** in Settings to auto-populate tasks for specific event types

### Tags

Create colour-coded tags in **Settings → Tags** and apply them to bookings and albums for quick filtering. Examples: `convention`, `urgent`, `cosplay`, `returning-client`.

### Contracts

Attach a PDF contract to a booking and send the client a signing link. They type their name to "sign" (with IP and timestamp recorded). The contract status (pending/signed) shows on the booking card.

### Email Automation

In Settings, set up automated reminder emails:

- X hours after booking → send payment reminder
- X hours before event → send "see you tomorrow" reminder
- X hours after event → send thank-you / gallery delivery reminder

All use configurable templates with `{{name}}`, `{{event}}`, `{{date}}`, `{{time}}` variables.

---

## Mobile Capture App

The **Capture** mode (`/capture`) is designed for use on a phone or tablet at a convention. Features:

- See all today's bookings in a scrollable list
- Tap a booking to enter capture mode for that client
- Upload photos directly from the camera roll or via USB camera (Capacitor/Android)
- Photos appear immediately in the associated album
- **Offline queue** — if you lose Wi-Fi at the venue, photos are saved to device storage (IndexedDB) and automatically uploaded when connectivity returns
- **Network status indicator** — shows Online / Server Down / No Network / X queued

### Offline Queue

When offline, a "X queued" indicator appears in the header. Photos are stored in the browser's IndexedDB database and uploaded automatically when you come back online.

---

## iCal / Calendar Feed

Subscribe to your bookings from any calendar app (Apple Calendar, Google Calendar, Outlook, Fantastical, etc.).

**Setup:**
1. Go to **Settings** → scroll to **iCal / Calendar Feed**
2. Click **Generate iCal Feed URL**
3. Copy the URL and subscribe to it in your calendar app:
   - Apple Calendar: File → New Calendar Subscription → paste URL
   - Google Calendar: Other Calendars → From URL → paste URL
   - Outlook: Add Calendar → From Internet → paste URL

**Notes:**
- The URL contains a private token — keep it secret
- Use **Rotate URL** to generate a new token if needed
- Click the `webcal://` link to open directly in macOS/iOS Calendar
- Cancelled bookings are excluded from the feed
- Each booking shows client name, session type, duration, and payment status

Multi-tenant photographers each get their own iCal token in their tenant admin settings.

---

## PWA Push Notifications

PhotoFlow can send push notifications (new bookings, payments received, etc.) using the Web Push API.

**Server setup:**
1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Add to `docker-compose.yml`:
   ```yaml
   - VAPID_PUBLIC_KEY=your_public_key
   - VAPID_PRIVATE_KEY=your_private_key
   - VAPID_SUBJECT=mailto:you@example.com
   ```
3. Restart the server

**Browser setup:**
1. Visit your admin panel on the device you want notifications on
2. Accept the notification permission prompt
3. The service worker registers automatically

The service worker also enables basic offline functionality — the app shell loads without internet.

---

## Multi-Tenant (Multiple Photographers)

PhotoFlow supports running multiple photographers from a single deployment. Each tenant gets:

- Their own booking page at `/book/their-slug`
- Isolated bookings, albums, event types, and settings
- Their own Stripe keys, SMTP, watermark, and Discord webhook
- Optional custom domain (e.g. `bookings.theirsite.com`)

**Super Admin setup:**
1. Go to **Platform** tab (only visible to the super admin)
2. Create a tenant: set their slug, display name, and email
3. Generate a **Setup Token** and share the `/tenant-setup/:token` link with them
4. They complete their own onboarding without seeing your data

---

## Integrations

### Stripe

Required for card payments. Set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` in environment variables. Stripe webhooks are handled at `/api/stripe/webhook`.

### SMTP Email

For booking confirmations, gallery delivery notifications, and automated reminders. Supports any SMTP provider (Gmail, Resend, Mailgun, etc.).

```yaml
- SMTP_HOST=smtp.gmail.com
- SMTP_PORT=587
- SMTP_USER=you@gmail.com
- SMTP_PASS=your-app-password
- SMTP_FROM=PhotoFlow <you@gmail.com>
- SMTP_SECURE=false
```

For Gmail: create an App Password in your Google account security settings (not your account password).

### Google Calendar Sync

Bookings can be synced to a Google Calendar. Configure OAuth2 credentials from Google Cloud Console in Settings → Google Calendar.

### Discord Webhooks

Get Discord notifications for new bookings, payments, proofing submissions, and invoices. Set a webhook URL in Settings → Notifications.

### FTP Upload

Automatically upload delivered galleries to an FTP server. Configure in Settings → FTP Upload. Supports organising photos into sub-folders by album name and moving starred photos to a separate folder.

---

## Configuration Reference

All configuration is done via environment variables in `docker-compose.yml`:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5066` |
| `DATA_DIR` | Path to data directory | `/data` |
| `SUPER_ADMIN_USERNAME` | Auto-create admin account | — |
| `SUPER_ADMIN_PASSWORD` | Admin password | — |
| `SMTP_HOST` | SMTP server hostname | — |
| `SMTP_PORT` | SMTP port (587 or 465) | — |
| `SMTP_USER` | SMTP username / email | — |
| `SMTP_PASS` | SMTP password or app password | — |
| `SMTP_FROM` | Sender name and email | — |
| `SMTP_SECURE` | Use TLS (`true`/`false`) | `false` |
| `STRIPE_SECRET_KEY` | Stripe secret key | — |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | — |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | — |
| `STRIPE_CURRENCY` | ISO currency code | `aud` |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key | — |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key | — |
| `VAPID_SUBJECT` | Web Push subject (mailto:) | — |

---

## Android APK Build

PhotoFlow can be built as a native Android app using Capacitor, which unlocks USB camera support for convention shooting.

```bash
npm install
npm run build
npx cap sync android
npx cap open android   # opens Android Studio
```

In Android Studio: Build → Build Bundle(s)/APK(s) → Build APK. Transfer to your Android device (enable "Install unknown apps" in Settings if needed).

---

## Troubleshooting

**Photos not uploading** — Check that `./data/uploads` exists and the Docker container has write permissions. Run `docker compose logs` for errors.

**Emails not sending** — Verify SMTP settings in Settings tab. For Gmail, use an App Password (not your account password). Test SMTP by triggering a booking confirmation email.

**Stripe webhooks failing** — Make sure `STRIPE_WEBHOOK_SECRET` matches the secret in your Stripe Dashboard → Webhooks. The endpoint is `https://yourdomain.com/api/stripe/webhook`.

**iCal feed not updating** — Calendar apps cache feeds aggressively. Force a manual refresh. Google Calendar updates external feeds every 24 hours maximum.

**Watermarks not appearing** — Check Storage tab → Preview & Watermark Rendering. The background renderer processes large uploads over a few minutes.

**"Server unavailable"** — The app is running in localStorage-only mode. Make sure the Docker container is running on port 5066. Check `docker compose logs` for errors.

**Data backup** — The database is `./data/db.json`. Back up the entire `./data/` directory regularly (including uploads). The database uses debounced writes so a clean shutdown (`docker compose stop`) flushes any pending writes first.

---

*PhotoFlow is built with React 18, TypeScript, Vite, Express, Sharp, and Tailwind CSS. Self-hosted. No external dependencies for core features.*
