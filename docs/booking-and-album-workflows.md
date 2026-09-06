# Booking extras and album operations

## Configure optional booking extras

Open **Admin → Events → Edit event → Booking extras**. Add a name, price per item and maximum quantity. For example: Composite image, $35.25 each, maximum 10.

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
