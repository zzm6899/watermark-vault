# 📸 Watermark Vault

> **Your complete photography business, in one self-hosted app.**

Watermark Vault is an all-in-one platform built for photographers who want full control over their bookings, galleries, client proofing, and payments — without paying monthly SaaS fees. Deploy it on your own server, keep 100% of your revenue.

---

## ✨ App Pitch

Running a photography business means juggling bookings, galleries, invoices, client communication, and payments across a dozen different apps. Watermark Vault brings everything together in a single, beautiful, self-hosted platform that you own completely.

- **No per-seat fees** — deploy once, use forever
- **No third-party gallery hosting** — your photos, your server
- **Fully watermarked previews** — clients see your work, not download it
- **End-to-end workflow** — from the first enquiry to the final delivery

---

## 🚀 Features

### 📅 Booking System
Create flexible event types with custom pricing, durations, and availability windows. Clients book directly on your public page — you choose whether bookings are instant or require confirmation.

- Multiple session types (portraits, weddings, events, etc.)
- Per-event questionnaires with custom fields
- Recurring weekly availability + one-off specific dates
- Blocked date management
- Deposit collection (fixed or percentage) via Stripe or bank transfer
- 15-minute booking hold timer to prevent double-bookings
- Client self-service booking modification page

### 📸 Photo Galleries & Albums
Upload your photos and deliver them in beautifully organised, watermarked galleries.

- Drag-and-drop batch upload (up to 100 photos at once)
- Per-album access codes for private client galleries
- Configurable watermark — text or image, 6 position options, opacity and size controls
- Gallery expiry dates
- Server-side watermarking (photos are never delivered clean without payment)
- Multiple display sizes (small / medium / large / list)

### 💳 Payment Processing
Accept payments online without paying per-transaction platform fees beyond Stripe's standard rates.

- **Stripe integration** — card payments for bookings, photo purchases, invoices
- **Bank transfer** — BSB, account number, PayID support
- Per-photo pricing + full-album bulk pricing
- Deposit workflows linked to bookings
- Automatic Stripe Checkout session generation

### 📄 Invoicing
Create, send, and track invoices — all from your admin panel.

- Custom line items with quantity and unit price
- Tax (GST/VAT) and discount support
- Public share link — clients view and pay without an account
- Stripe payment link on invoice
- Email invoices and payment reminders directly from the app
- Invoice status tracking: Draft → Sent → Paid → Overdue

### ⏱️ Client Proofing
Send galleries to clients for photo selection before final delivery.

- Multi-round proofing workflow
- Clients star/select photos and leave notes
- Admin sees selections and responds
- Proofing stage tracking (sent → selections submitted → approved)

### 💌 Email Automation
Automated transactional emails for every step of the client journey.

- Booking confirmation and enquiry auto-replies
- Gallery delivery notifications with access link
- Invoice emails and payment reminders
- Customisable email templates with rich text editor
- SMTP configuration (works with Gmail, Zoho, Mailgun, etc.)

### 📋 Enquiry Form
Capture leads before they become bookings.

- Public-facing enquiry form on your booking page
- Custom label ("Make an Enquiry", "Get a Quote", etc.)
- Admin accepts or declines enquiries
- Accepting an enquiry automatically creates a booking

### 👥 Contacts & CRM
Keep track of all your clients in one place.

- Contact profiles with name, email, phone, company, address, ABN
- Link contacts to invoices and bookings
- Notes per contact

### 📊 Finance Dashboard
Get a real-time view of your business performance.

- Revenue charts by month
- Unpaid vs paid invoice tracking
- Booking revenue by event type
- Outstanding balances

### 🔔 Discord Notifications
Get notified instantly for every business event.

- New bookings
- Booking status changes and payments
- Photo download requests
- Proofing submissions
- Invoice events (created, sent, paid, overdue)
- Test webhook button in settings

### 🗓️ Google Calendar Integration
Keep your schedule in sync without manual entry.

- OAuth 2.0 Google Calendar connection
- Auto-sync bookings to Google Calendar
- Bulk sync all existing bookings
- Calendar ID selection

### 📊 Google Sheets Export
Export your booking data to Google Sheets for reporting.

- One-click sync of all bookings
- Sheet ID configuration

### 📱 Mobile Capture Mode
Capture photos directly on set with your phone or tablet.

- On-device camera integration (Android/iOS via Capacitor)
- Photos upload directly to albums
- Purpose-built on-set shooting interface

### 🗂️ Admin Dashboard
A comprehensive admin panel with everything you need to run your business.

- 12-section navigation: Dashboard, Bookings, Events, Albums, Photos, Finance, Invoices, Contacts, Enquiries, Profile, Settings, Storage
- Mobile-first responsive layout with bottom tab bar on phones
- Booking and album search/filter
- Bulk operations (delete, merge albums, etc.)
- Storage usage monitoring with disk stats
- Server image cache management

### 🔑 License Key System
Issue license keys to let other photographers deploy their own Watermark Vault instance.

- Generate keys with optional expiry dates and notes
- Keys are required for new deployments once any key exists
- Track which keys have been used and by whom
- Revoke keys at any time
- `WV-XXXX-XXXX-XXXX-XXXX` format

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui + TailwindCSS + Framer Motion |
| Backend | Node.js + Express |
| Storage | JSON file on disk (`/data/db.json`) + localStorage sync |
| Images | Sharp for server-side processing and watermarking |
| Payments | Stripe Checkout |
| Mobile | Capacitor (Android/iOS) |
| Deployment | Docker + nginx on port 5066 |

---

## 🐳 Deployment

### Quick Start with Docker Compose

```bash
mkdir -p /your/data/path
cd /your/data/path

# Create docker-compose.yml:
cat > docker-compose.yml << 'EOF'
version: "3.9"
services:
  watermark-vault:
    image: ghcr.io/zzm6899/watermark-vault:latest
    ports:
      - "5066:5066"
    volumes:
      - ./data:/data
    restart: unless-stopped
EOF

docker compose up -d
```

App runs at **`http://your-server:5066`**

### Build from Source

```bash
git clone https://github.com/zzm6899/watermark-vault.git
cd watermark-vault
npm install
npm run build
node server/index.js
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5066` | Server port |
| `DATA_DIR` | `/data` | Data directory for uploads and db.json |

---

## 🔧 First-Time Setup

1. Open the app in your browser
2. The setup wizard will guide you through:
   - Creating your admin username and password
   - Setting up your profile (name, bio, avatar)
   - Creating your first event type
   - Configuring payment methods (Stripe / bank transfer)
3. Once setup is complete, you're taken directly to the admin dashboard

> **License key required?** If the app owner has issued license keys, you'll need to enter a valid `WV-XXXX-XXXX-XXXX-XXXX` key during setup.

---

## 🔑 License Keys

If you want to share Watermark Vault with other photographers:

1. Log in to your admin panel → **Settings** → scroll down to **License Keys**
2. Click to expand the License Keys panel
3. Fill in "Issued To" (name or email), optional expiry date and notes
4. Click **Generate Key** — a `WV-XXXX-XXXX-XXXX-XXXX` key is created
5. Share the key with the recipient
6. They enter it during setup on their own deployment

Once any keys have been generated, **all new deployments require a valid key** to complete setup. Keys can be revoked at any time.

---

## 📧 Email Configuration

Go to **Admin → Settings → Email & Notifications** and configure your SMTP details:

| Setting | Example |
|---------|---------|
| SMTP Host | `smtp.gmail.com` |
| SMTP Port | `587` |
| Username | `you@gmail.com` |
| Password | App password (not your Google password) |

For Gmail, generate an [App Password](https://myaccount.google.com/apppasswords).

---

## 💳 Stripe Configuration

1. Create a [Stripe account](https://stripe.com)
2. Get your Secret Key from Stripe Dashboard → Developers → API keys
3. In Admin → Settings → Payments, enter your Stripe Secret Key
4. Enable Stripe and save

Stripe handles all card payments for bookings, photo purchases, and invoices.

---

## 🤖 Discord Notifications

1. Create a Discord webhook in your server (Channel Settings → Integrations → Webhooks)
2. Copy the webhook URL
3. In Admin → Settings → Notifications, paste the webhook URL
4. Toggle which events trigger notifications
5. Test with the "Send Test" button

---

## 🗓️ Google Calendar

1. In Admin → Settings → Google Calendar, click **Connect Google Calendar**
2. Authorise the app with your Google account
3. Select which calendar to sync to
4. New bookings will automatically appear in your calendar
5. Use "Sync All Bookings" to back-fill existing bookings

---

## 🔄 CI/CD & Updates

The GitHub Actions workflow at `.github/workflows/docker-build.yml` automatically:

1. Builds the Docker image on every push to `main`
2. Pushes it to **GitHub Container Registry (GHCR)** as `ghcr.io/zzm6899/watermark-vault:latest`

To update your deployment:

```bash
docker compose pull && docker compose up -d
```

---

## 🛡️ Data & Privacy

- All data is stored on **your own server** — nothing leaves your machine
- Photos are served through the Node.js backend (never directly from disk)
- Watermarks are applied server-side so original files are never exposed
- Admin auth uses SHA-256 password hashing
- No analytics, no telemetry, no third-party data collection

---

## 📁 Project Structure

```
watermark-vault/
├── server/               # Node.js/Express backend
│   ├── index.js          # Main server, REST API, photo serving
│   ├── email.js          # SMTP email sending
│   ├── discord.js        # Discord webhook helpers
│   ├── stripe.js         # Stripe Checkout integration
│   ├── google-calendar.js
│   └── google-sheets.js
├── src/
│   ├── pages/
│   │   ├── Admin.tsx     # Full admin dashboard
│   │   ├── Booking.tsx   # Public booking page
│   │   ├── Setup.tsx     # First-time setup wizard
│   │   ├── Login.tsx     # Admin login
│   │   ├── AlbumDetail.tsx
│   │   ├── ClientPortal.tsx
│   │   ├── InvoiceView.tsx
│   │   └── MobileCapture.tsx
│   ├── components/       # Reusable UI components
│   ├── lib/
│   │   ├── api.ts        # Backend API client
│   │   ├── storage.ts    # localStorage helpers
│   │   └── types.ts      # TypeScript types
│   └── hooks/
├── Dockerfile
├── docker-compose.yml
└── nginx.conf
```

---

## 📜 License

This project is private. All rights reserved.

