"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAutomationEmail,
  buildBookingEmailHtml,
  buildBookingEmailText,
  buildBookingUpdateEmail,
  buildClientPortalEmail,
  buildGalleryDeliveryEmail,
  buildInvoicePaidEmail,
  bookingEmailReference,
  prepareCustomEmail,
  sendBookingConfirmationEmail,
} = require("../email");

const base = {
  clientName: "Client",
  eventTitle: "Portrait",
  date: "2026-08-10",
  time: "10:00",
  duration: 60,
  location: "Studio",
  price: 500,
  depositAmount: 100,
  remainingAmount: 400,
  isFree: false,
  bookingId: "booking-1",
  calendarUrl: "https://calendar.example",
  status: "confirmed",
};

test("booking email references stay short while canonical IDs remain internal", () => {
  const longId = "bk-12345678-1234-4abc-9def-123456789abc";
  assert.equal(bookingEmailReference(longId), "BK-89ABC");
  assert.equal(bookingEmailReference(longId, "PF-9A8B7C6D"), "PF-9A8B7C6D");

  const html = buildBookingEmailHtml({ ...base, bookingId: longId, paymentReference: "PF-9A8B7C6D", paymentMethod: "bank" });
  const text = buildBookingEmailText({ ...base, bookingId: longId, paymentReference: "PF-9A8B7C6D", paymentMethod: "bank" });
  assert.match(html, /Reference: PF-9A8B7C6D/);
  assert.match(text, /Reference: PF-9A8B7C6D/);
  assert.doesNotMatch(`${html}${text}`, new RegExp(longId));
});

test("pay-in-full booking receipts do not mislabel the configured deposit as the amount paid", () => {
  const full = buildBookingEmailHtml({ ...base, paymentMethod: "stripe", paymentKind: "full" });
  assert.match(full, /\$500 ✓ Paid in Full/);
  assert.doesNotMatch(full, /Deposit Paid/);

  const deposit = buildBookingEmailHtml({ ...base, paymentMethod: "stripe", paymentKind: "deposit" });
  assert.match(deposit, /Deposit Paid/);
  assert.match(deposit, /\$100 ✓ Card/);
});

test("booking emails use the responsive branded shell and escape untrusted booking fields", () => {
  const html = buildBookingEmailHtml({
    ...base,
    clientName: "Alex <script>alert(1)</script>",
    eventTitle: "Portrait <img src=x onerror=alert(1)>",
    location: "Studio & Garden",
    brandName: "Acme <Studio>",
    modifyUrl: "javascript:alert(1)",
    calendarUrl: "https://calendar.example/session?id=1&source=email",
  });

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /data-photoflow-email="true"/);
  assert.match(html, /@media only screen and \(max-width:620px\)/);
  assert.match(html, /Acme &lt;Studio&gt;/);
  assert.match(html, /Alex &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Portrait &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Studio &amp; Garden/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /https:\/\/calendar\.example\/session\?id=1&amp;source=email/);
});

test("booking plain text mirrors the operational details and safe actions", () => {
  const text = buildBookingEmailText({
    ...base,
    clientName: "Client",
    paymentMethod: "stripe",
    paymentKind: "deposit",
    modifyUrl: "https://photos.example/booking/modify/token",
    unsubscribeUrl: "https://photos.example/unsubscribe/token",
  });

  assert.match(text, /Booking confirmed/);
  assert.match(text, /Session: Portrait/);
  assert.match(text, /Date: Monday,? 10 August 2026/);
  assert.match(text, /Deposit Paid: \$100 ✓ Card/);
  assert.match(text, /View or manage booking: https:\/\/photos\.example\/booking\/modify\/token/);
  assert.match(text, /Unsubscribe: https:\/\/photos\.example\/unsubscribe\/token/);
  assert.doesNotMatch(text, /<[^>]+>/);
});

test("booking update emails distinguish reschedules from cancellations", () => {
  const rescheduled = buildBookingUpdateEmail({
    clientName: "Client",
    eventTitle: "Wedding",
    previousDate: "2026-08-10",
    previousTime: "10:00",
    date: "2026-08-12",
    time: "14:30",
    duration: 90,
    bookingId: "booking-2",
    modifyUrl: "https://photos.example/booking/modify/token",
    updateType: "reschedule",
    brandName: "North Studio",
  });
  const cancelled = buildBookingUpdateEmail({
    clientName: "Client",
    eventTitle: "Wedding",
    date: "2026-08-12",
    time: "14:30",
    bookingId: "booking-2",
    updateType: "cancel",
  });

  assert.equal(rescheduled.subject, "Booking rescheduled — Wedding");
  assert.match(rescheduled.html, /Previous date/);
  assert.match(rescheduled.html, /Wednesday,? 12 August 2026/);
  assert.match(rescheduled.text, /New time: 2:30 PM/);
  assert.equal(cancelled.subject, "Booking cancelled — Wedding");
  assert.match(cancelled.html, /Cancellation confirmed/);
  assert.doesNotMatch(cancelled.html, /Previous date/);
});

test("gallery and portal emails retain safe links, access details, and plain-text parity", () => {
  const gallery = buildGalleryDeliveryEmail({
    clientName: "Taylor & Sam",
    albumTitle: "Wedding <Highlights>",
    galleryUrl: "https://photos.example/gallery/wedding#token=abc",
    accessCode: "KEEP-PRIVATE",
    photoCount: 42,
    brandName: "North Studio",
    smtpPassword: "must-not-leak",
  });
  const portal = buildClientPortalEmail({
    albums: [
      { title: "Family <script>", url: "https://photos.example/gallery/family" },
      { title: "Unsafe", url: "javascript:alert(1)" },
    ],
    brandName: "North Studio",
  });

  assert.match(gallery.html, /Wedding &lt;Highlights&gt;/);
  assert.match(gallery.html, /KEEP-PRIVATE/);
  assert.match(gallery.text, /Photos: 42/);
  assert.match(gallery.text, /Open gallery: https:\/\/photos\.example\/gallery\/wedding#token=abc/);
  assert.doesNotMatch(`${gallery.html}${gallery.text}`, /must-not-leak/);
  assert.match(portal.html, /Family &lt;script&gt;/);
  assert.doesNotMatch(portal.html, /javascript:/i);
  assert.match(portal.text, /Family <script>: https:\/\/photos\.example\/gallery\/family/);
});

test("invoice-paid email presents the settled total without exposing unsafe actions", () => {
  const message = buildInvoicePaidEmail({
    number: "INV-42<script>",
    currency: "AUD",
    items: [{ description: "Photography", quantity: 2, unitPrice: 125 }],
    discount: 25,
    tax: 10,
    paidAt: "2026-08-08T00:00:00.000Z",
    to: { name: "Client <One>", email: "client@example.com" },
    from: { name: "North & Co" },
  }, "javascript:alert(1)");

  assert.equal(message.subject, "Payment Received — INV-42<script>");
  assert.match(message.html, /Client &lt;One&gt;/);
  assert.match(message.html, /INV-42&lt;script&gt;/);
  assert.match(message.html, /\$247\.50/);
  assert.match(message.text, /Total paid: \$247\.50/);
  assert.doesNotMatch(message.html, /href="javascript:/i);
});

test("configured automation text is escaped and never treated as executable markup", () => {
  const message = buildAutomationEmail({
    subject: "Reminder\r\nBcc: attacker@example.com",
    body: "Hi Client\n<img src=x onerror=alert(1)>",
    booking: { id: "booking-3", type: "Portrait", date: "2026-08-10", time: "10:00" },
  });

  assert.equal(message.subject, "Reminder Bcc: attacker@example.com");
  assert.match(message.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(message.html, /<img src=x onerror=/i);
  assert.match(message.text, /<img src=x onerror=alert\(1\)>/);
});

test("custom email preparation wraps fragments once and supplies plain-text parity", () => {
  const first = prepareCustomEmail({
    subject: "Your quote",
    html: "<p>Hello <strong>Client</strong></p><p><a href=\"https://photos.example/quote/token?a=1&amp;b=2\">View quote</a></p>",
    brandName: "North Studio",
  });
  const second = prepareCustomEmail({ subject: "Your quote", html: first.html, text: first.text, brandName: "North Studio" });

  assert.equal((first.html.match(/data-photoflow-email="true"/g) || []).length, 1);
  assert.equal((second.html.match(/data-photoflow-email="true"/g) || []).length, 1);
  assert.equal(second.html, first.html);
  assert.match(first.text, /Hello Client/);
  assert.match(first.text, /View quote \(https:\/\/photos\.example\/quote\/token\?a=1&b=2\)/);

  const markerInContent = prepareCustomEmail({
    subject: "Marker text",
    html: '<p>Client supplied data-photoflow-email="true" as text.</p>',
    brandName: "North Studio",
  });
  assert.match(markerInContent.html, /^<!doctype html>/i);
  assert.match(markerInContent.html, /class="email-shell" data-photoflow-email="true"/);
});

test("booking sender normalizes subjects and delivers matching HTML and text alternatives", async () => {
  let delivered;
  const result = await sendBookingConfirmationEmail({
    to: "client@example.com",
    clientName: "Client <One>",
    eventTitle: "Portrait\r\nBcc: attacker@example.com",
    date: "2026-08-10",
    time: "10:00",
    duration: 60,
    price: 500,
    depositAmount: 100,
    paymentMethod: "stripe",
    paymentKind: "full",
    modifyToken: "safe-token",
    bookingId: "booking-4",
    appBaseUrl: "https://photos.example",
    status: "confirmed",
    brandName: "North Studio",
    transport: { sendMail: async message => { delivered = message; return { messageId: "message-1" }; } },
  });

  assert.equal(result.ok, true);
  assert.equal(delivered.subject, "Booking Confirmed — Portrait Bcc: attacker@example.com");
  assert.match(delivered.html, /Client &lt;One&gt;/);
  assert.match(delivered.text, /View or manage booking: https:\/\/photos\.example\/booking\/modify\/safe-token/);
  assert.doesNotMatch(delivered.subject, /[\r\n]/);
});
