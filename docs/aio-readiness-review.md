# PhotoFlow: all-in-one readiness review

Reviewed 26 September 2026. Scope: this repository's public website, main studio administration, tenant administration, client flows, capture, backend and automated checks. This is a code and local acceptance review, not a production security certification or a visual browser audit. That baseline review did not change application behavior. The implementation update below records the subsequent requested fixes.

## Implementation update — 26 September 2026

The six priority findings below are addressed in the working tree:

- Enquiry acceptance commits the booking and enquiry together, returns the canonical booking on retries, and can repair an accepted enquiry with no booking. Stale collection saves preserve an existing booking link.
- Capture uses the existing IndexedDB queue, recovers interrupted uploads, retains files on failure, and records server upload receipts. Browser reload and server restart checks cover recovery and tenant scope.
- Quote conversion reuses the original invoice and rejects edits to actioned quotes. Studio-owned quotes, expenses and contracts use scoped routes.
- Main-studio store and album writes have a durable browser outbox, visible pending/error state and server acknowledgement. Credentials are excluded from stored drafts and require re-entry after reload. The affected store and album routes commit to SQLite before success.
- Waitlist notifications use the implemented booking entry route. Finance uses stored transfer amounts, flags unknown historical amounts and excludes cancelled requests.
- Main and tenant booking workspaces share contracts, payment schedules, and convention details. Instalments support due dates, card checkout with verified webhook settlement, explicit bank/cash receipt recording, removal of unpaid scheduled items and client schedule emails. Removing an instalment does not forgive the booking balance.
- Event meeting points, map links, arrival instructions and relative delivery targets are copied into bookings. Booking overrides retain the agreed details. They appear in booking views, confirmation/reminder emails, automation messages and client recovery emails.

Tenant parity here covers the agreed photography-business additions: quotes, expenses, contracts, instalments and booking/convention workflows. Platform administration and APK publishing remain owner-only. Existing tenant invoice payment options and the other unrequested audit suggestions below are unchanged.

Verification commands: `npm test`, `npm test --prefix server`, `npm run typecheck`, `npm run lint`, `npm run check:admin-bundle`, `node server/business-acceptance.cjs`, `node server/product-acceptance.cjs`, and `npm --prefix server run test:staging`. The browser capture check runs at `/scripts/capture-reload-check.html` under Vite.

These checks use synthetic records, a local email sink and mocked Stripe checkout/signature fixtures. No live card charge, production email or deployment was performed. Each studio still needs its own configured SMTP and Stripe webhook credentials for those integrations.

## Assessment

The product already contains most of the major modules a photography studio needs. The biggest improvement is to make those modules form one dependable journey:

**Enquiry → agreed quote → booking → contract → payment → shoot → proofing → editing → delivery → repeat booking.**

Prioritize reliable handoffs, recoverable operations and honest feature availability before adding more modules. Main-studio and tenant functionality need separate acceptance checks; having a feature in one does not mean the other supports it.

## Fix first: concrete findings

These findings come from traced source paths. Existing passing tests do not establish coverage of these failure cases.

| Priority | Finding and impact | Smallest useful improvement | Completion check |
|---|---|---|---|
| P1 | **Enquiry acceptance can claim success without a booking.** `ClientAdminViews.tsx:77` calls asynchronous `addBooking` without awaiting it, then accepts the enquiry and sends the acceptance email. `storage.ts:169` rolls back the booking on failure. A rejected or disconnected booking request can leave an accepted enquiry pointing at a nonexistent booking. | Await the saved booking, use its canonical ID/token and update the enquiry only on success. Disable repeat clicks; make the eventual server conversion safe to retry. | Reject booking creation and verify the enquiry remains pending with no acceptance email. Retry a successful conversion and retain one booking. |
| P1 | **Offline capture is not consistently durable.** `MobileCapture.tsx:658` keeps its active offline queue in React state; failed/offline imports append to that queue. The IndexedDB writer `queueOfflineCapture` is imported but has no caller. Reloading loses queued work, even though the README promises device persistence. Separately, `usePwa.ts:232` retries only `queued`/`error`, leaving an interrupted IndexedDB `uploading` record stranded. | Use the existing IndexedDB store as the authoritative offline queue. Persist files before reporting them queued, recover interrupted work and deduplicate retries. Preserve album and tenant ownership. | Queue while offline, close/reopen, reconnect, and verify every file reaches its original album exactly once. Repeat with a crash during upload and an expired login. |
| P1 | **Quote conversion can create duplicate invoices.** `server/index.js:10940` creates a fresh invoice on every call without checking `convertedInvoiceId`; the UI handler at `FinanceView.tsx:1029` has no in-flight lock. | Return the existing converted invoice on retry, enforce allowed quote states and copy the agreed currency/financial fields explicitly. Add a pending state to the button. | Double-click and retry after a lost response; both return the same invoice. Confirm quote and invoice totals/currency agree. |
| P1 | **Some saves acknowledge browser storage rather than server persistence.** `storage.ts:28` and `api.ts:401` use fire-and-forget writes with in-memory retry queues. Event/profile/settings edits can appear saved, then lose their pending write after a reload and subsequent server sync. | Show Saved only after server acknowledgement; otherwise show Unsaved/Retry. Reuse the awaited mutation approach already used for bookings and invoices. If offline editing is required, persist a dirty record and reconcile it before loading server values over it. | Save during an outage, reload, reconnect and verify the user can recover the edit. Test permanent validation errors as well as network errors. |
| P2 | **Waitlist emails lead to an unregistered page.** `server/index.js:11766` builds `/booking`, while the router exposes `/` and `/book/:tenantSlug`. The handler sends a general booking link; the README's time-limited claim workflow is not implemented here. | Fix the destination immediately. Present the existing feature as an availability notification; add expiring reserved-slot claims only if that workflow is needed. | Open the actual captured email link and complete a booking. If implementing claims, verify expiry and competing claim attempts. |
| P2 | **Finance can reprice old bank-transfer requests and count cancelled requests as pending.** `FinanceView.tsx:108` falls back to current photo prices when a historical amount is missing, then classifies every non-approved/completed request as pending. | Use stored amounts only, label unknown amounts, and exclude cancelled requests from pending totals. Reuse the more conservative server reporting rules. | Change today's price and confirm old revenue stays unchanged. Cancel a request and confirm pending totals decrease. |

## Finish or accurately describe existing features

| Feature | What exists | What would make it complete |
|---|---|---|
| **Contracts** | PDF upload/signing endpoints, API helpers and a public signing page. Searches found no admin caller for `createContract` or `getContracts`. | A contract section on the booking: attach, send, view signing status, remind, and download the document plus signing record. Tie it to the client workflow. Add tenant ownership before exposing it to tenants. |
| **Instalments** | Create/update endpoints and overdue marking, but no admin callers for the API helpers and no instalment checkout flow found. Creation also accepts an unvalidated booking ID and `Number(amount) || 0`. | Validate booking ownership, positive amounts, dates and plan totals. Add a booking payment schedule and connect settlement to the real booking balance. For the smallest first version, label it as a manual schedule instead of automatic collection. |
| **Photo feedback** | The README promises client comments. The server explicitly says legacy comments were removed from the public gallery DTO/UI; routes require admin authentication (`index.js:11313`). | Add recipient-scoped per-photo retouching notes and a photographer resolution state if wanted. Otherwise correct the feature claim. Do not simply remove authentication from the old routes. |
| **Push notifications** | Subscription helpers, storage endpoints and service-worker support. No backend push sender or UI caller of the subscription helper was found. | Either connect an opt-in control and real event delivery with expired-subscription cleanup, or remove the claim that new-booking/payment pushes are working. Email already covers the immediate notification need. |
| **Refund handling** | The finance action records an externally completed full refund; it explicitly does not move funds. | Keep that distinction visible. Add partial-refund records and provider reconciliation before offering refunds initiated inside the app. Ensure history, reports and purchased access follow an explicit refund policy. |
| **Gallery delivery** | Delivery updates gallery state and then attempts email (`index.js:11628`). Email failure is returned transiently rather than saved as a delivery-job status. Recovery emails already have a persisted failure/retry pattern. | Reuse that pattern: show Gallery ready separately from Email sent/failed, retain the failure and offer retry without repeating unrelated delivery changes. |
| **Tenant feature parity** | Tenant bookings, albums, invoices and integrations exist. Contracts, quotes, expenses and instalments reviewed here use main-admin routes/stores; matching tenant routes were not found. | Define a supported-feature matrix. Share one completed vertical workflow at a time, including tenant data isolation and notifications, instead of assuming parity. |

## Highest-value additions

1. **A real client hub.** `/my-gallery` currently sends recovery links by email; it is not a full account workspace. Extend the existing magic-link approach to show upcoming sessions, balance/payment actions, contracts, reference uploads, proofing, delivery and previous purchases in one place. Keep access scoped to the verified client and studio. Start with a session summary and the next required action.

2. **One session workspace for the photographer.** Contacts already have an activity timeline, and bookings/albums have many of the necessary records. Bring them together around a booking: agreed extras, money due, contract status, shoot notes, selection receipt, editing tasks and delivery. Reuse those records instead of adding another independent status system.

3. **An actionable studio inbox.** Aggregate existing payment reviews, bank-transfer requests, submitted selections and recovery-email failures, then add missing contract signatures and overdue deliveries. Every row should explain the issue and link to the action that resolves it. A simple filtered list is sufficient.

4. **Gallery upgrade pricing.** Credit eligible previously purchased photos toward a full-album upgrade. The staging notes already identify this as missing. Calculate the credit server-side from verified purchases, with a clearly displayed payable amount and repeat-checkout protection.

5. **Client change policies.** Self-service cancellation and rescheduling already exist. Add configurable notice windows, clear outcomes for paid deposits and an exception request to the photographer when changes are outside the allowed window. Enforce the same rules in the API.

6. **Convention details attached to the booking.** Add a reusable meeting-point map/link, arrival instructions and an agreed delivery target to confirmation, reminders and the client hub. Reuse event settings and existing shoot-day views.

Defer a print shop, loyalty system, broad AI features and a separate chat platform until the above flows are dependable and there is demonstrated demand.

## Website and operational completeness

- **Publish accessible policy pages.** The booking page says clients agree to terms (`Booking.tsx:1369`) but provides no link in that notice, and the reviewed router has no terms/privacy pages. Add editable terms, cancellation, privacy and image-use information with links from the relevant forms. Record the version accepted where agreement is required. This is a product gap, not an assessment of legal compliance.
- **Make the website journey consistent.** Provide clear navigation between portfolio, booking, contact and My sessions/photos. Keep branding, sender identity and support details tied to the active studio; the shared footer still has hard-coded fallback branding.
- **Complete recovery and account management.** Add a supported admin password-recovery path and optional stronger authentication. Add assistant/editor roles only when another person needs access; avoid sharing the owner login.
- **Prove backups restore.** A ZIP download already exists (`index.js:852`). It checkpoints SQLite then archives live files; it is not a coordinated database-and-media snapshot. Use a consistent database snapshot, define handling of files changing during backup, and rehearse restoration into an empty isolated instance. Add scheduled off-server backups and visible last-success status. This review did not reproduce backup corruption or inspect any external backup service.
- **Make failures visible.** Extend existing operations panels with failed delivery emails, interrupted imports, storage pressure and backup failures. Add a top-level recoverable React error screen; only a capture-specific error boundary was found.
- **Keep performance work evidence-led.** The build passed without oversized-chunk warnings. However, `Admin.tsx` is 10,945 lines, `TenantAdmin.tsx` 5,298, and `server/index.js` 11,885. Extract a workflow when changing it and share proven common behavior. Do not begin with a framework/database rewrite. Test large libraries and slow connections before choosing storage or rendering changes.
- **Add a small real-browser release check.** Existing tests and HTTP acceptance harnesses are valuable. Add coverage for booking → payment result → manage booking and proofing → delivery → download, including a mobile viewport, keyboard-only use, reloads and expired sessions. The current quality workflow runs unit and HTTP staging checks, not an automated browser journey.

## Delivery order

1. **Reliability:** enquiry acceptance, durable capture, repeat-safe quote conversion, acknowledged saves, waitlist link and finance corrections.
2. **Complete existing workflows:** booking-linked contracts, an honest instalment workflow, persistent delivery-email retries, policy links, backup restore check and corrected documentation.
3. **Connect the product:** client hub, session workspace and action inbox. Establish tenant parity for these completed flows.
4. **Grow revenue and convenience:** gallery upgrade credit, change policies and convention-specific information.

Each stage should pass an end-to-end journey with synthetic clients before moving to the next. The release bar is a client completing the journey and a photographer recovering an interrupted operation without manually repairing data.

## Checks run during this review

- `npm test -- --reporter=dot`: **301 tests passed across 60 files**. React `act(...)` and a `ref` warning appeared; they did not fail the suite.
- `npm test --prefix server`: **179 tests passed**.
- `npm run typecheck`: passed.
- `npm run lint`: no errors; one Fast Refresh export warning in `TenantBookingPage.tsx:146`.
- `npm run build`: passed.
- `node server/product-acceptance.cjs`: passed all five reported groups, covering booking extras/retries, authenticated transfer approval, finance/automation preview, mixed gallery transfers and client timelines.
- `npm --prefix server run test:staging`: passed proofing durability, captured local email delivery, purchase recovery, original download and ZIP entitlement checks.

These were local synthetic-data checks. No production deployment, real customer messages or live payments were performed. Hosted HTTPS/proxy behavior, actual inbox delivery, payment-provider challenges, visual responsiveness and load testing were not reverified. Earlier Stripe sandbox results documented in `STAGING.md` are historical evidence, not new tests from this review.
