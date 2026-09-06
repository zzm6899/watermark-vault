# Booking extras and album operations

## Configure optional booking extras

Open **Admin → Events → Edit event → Booking extras**. Add a name, an optional description (up to 300 characters), price per item and maximum quantity. Descriptions appear below each extra’s name on both public booking pages. For example: Composite image, $35.25 each, maximum 10.

Clients choose a quantity from zero to the configured maximum on the details step. The booking total is the selected duration price plus the extras. Percentage deposits apply to this combined total; fixed deposits remain fixed and cannot exceed the total. Pay-in-full charges the combined total.

The server validates integer quantities and calculates prices from the event configuration. It stores the session price and itemized extras with the booking. Later event edits do not change the agreed booking price. Itemization appears in booking details, payment review, confirmation, the manage-booking page, and confirmation emails. Main and tenant public booking pages support extras.

## Review download requests

Open **Admin → Albums → Download requests**, or use the inbox in Dashboard or Storage. A request means a gallery visitor chose bank transfer for paid photo access; it is not proof that payment arrived.

The inbox identifies the album, album client, requesting visitor email when recorded, selected photos or full album, recorded amount, date, note and status. Search by album, visitor, note or photo ID. Open an album to inspect its photos. Check the actual bank transfer before selecting **Confirm transfer & approve**.

Approval is a dedicated authenticated server operation. It grants access only to the requesting visitor, is safe to retry, rejects changed requests, and preserves photos and payment history. Stale album saves cannot revert or remove request records. Older requests without a visitor session require a fresh request from the gallery; they cannot safely be assigned to an arbitrary visitor.

Finance displays the recorded request amount when available and links to the album request workflow. Historical payment records are retained instead of pretending a browser-only deletion revoked access.

## Album library

- **Compact:** short covers and more cards per row.
- **Comfortable:** larger covers.
- **List:** small thumbnails, client/session metadata and common actions in rows.

Display preference is saved in the browser. Filter for pending downloads, submitted picks, delivered albums or hidden galleries. Search and sort apply to the whole library before pagination; pages contain up to 24 albums. Metadata polling pauses while the tab is hidden. Album links from requests survive admin sign-in.

## Verification

Run `npm run typecheck`, `npm test`, and `npm --prefix server test`. After `npm run build`, run `node server/product-acceptance.cjs` for isolated server checks with synthetic bookings and albums. Add `--serve` to keep the preview open for browser review. The harness uses temporary local data, no Stripe credentials, and no external email service. Preview credentials are defined only in that harness.

Deploy the frontend and backend together: the new approval inbox depends on the new server endpoint. No production bookings, payments or download requests are changed by the test harness.

## Booking and email refresh

The public booking pages use a dark charcoal layout with gold accents with readable labels, visible progress, larger touch targets, and a responsive two-column details form. Session descriptions collapse in the calendar view. Phone time lists have a bounded scroll area, a full-width Continue button shows the selected time, and step changes return to the top of the page. Extras have bounded plus/minus controls and select their existing value on focus. Main-booking details support keyboard submission through a real form. Shared email templates use a white header, neutral summary cards and a dark primary action, with responsive HTML and plain-text alternatives.

## Event revenue

Open Finance → Revenue by event. Group by event or event and shoot date, search event names, select a shoot-date range and export the filtered CSV. The report reads the server directly; it does not depend on visiting Albums first.

Booked value includes extras. Booking paid includes confirmed deposits or the full recorded price; balance is the unpaid remainder. Gallery paid uses fulfilled checkout orders and approved transfers with recorded amounts. Pending transfers remain separate. Recovery sessions do not create additional revenue. Legacy gallery entries without a verified amount are flagged and excluded rather than repriced using today's catalog. Invoices, refunds, fees, expenses and cancelled bookings are outside this report; it is not a net-profit or cashflow report. Unlinked galleries appear under Unassigned galleries. Historical activity and invoice analytics remain available in the expandable section.

## Automation controls

Seven paused starter templates cover booking preparation, event reminders, payment reminders, payment follow-up and feedback. Give rules names, limit them to an event and booking status, or select a booking creation start date. Duplicate a rule as a paused draft or pause all rules, then save. Zero-hour delays are supported. After-full-payment rules require a recorded paid timestamp. Event reminders use the studio timezone and are skipped after the session starts.

Preview shows recipient decisions and the same personalised subject/body used for sending. Variables include name, event, date, time, location, duration, total, balance and payment reference. Editing a rule clears its stale preview. Saving enabled rules checks recipients first and reports any messages currently due. Paused templates are not activated automatically. No real email was sent during this change's local verification.
