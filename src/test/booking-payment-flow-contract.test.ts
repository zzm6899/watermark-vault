import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("booking payment flow regressions", () => {
  it("keeps the active booking pointer isolated to one browser tab", () => {
    const bookingSource = source("src/pages/Booking.tsx");
    const modifySource = source("src/pages/BookingModify.tsx");

    expect(bookingSource).toContain('sessionStorage.getItem("lastBookingId")');
    expect(bookingSource).toContain('sessionStorage.setItem("lastBookingId", booking.id)');
    expect(bookingSource).not.toMatch(/localStorage\.(?:getItem|setItem|removeItem)\("lastBookingId"/);
    expect(modifySource).toContain('sessionStorage.removeItem("lastBookingId")');
  });

  it("recovers Android FTP files and keeps an explicit booking-album destination", () => {
    const captureSource = source("src/pages/MobileCapture.tsx");
    const pluginSource = source("android/app/src/main/java/app/lovable/cameraftp/CameraFtpPlugin.kt");

    expect(captureSource).toContain('const CAPTURE_TARGET_KEY = "cameraCaptureTarget:v1"');
    expect(captureSource).toContain("CameraFtp.listFiles({ limit: 500 })");
    expect(captureSource).toContain("Photos waiting");
    expect(captureSource).toContain("Upload destination");
    expect(captureSource).toContain("New FTP and USB photos upload straight to this booking album for preview.");
    expect(pluginSource).toContain("fun listFiles(call: PluginCall)");
  });

  it("reuses the booking already holding the slot for a card retry", () => {
    const bookingSource = source("src/pages/Booking.tsx");
    const paymentHandler = bookingSource.slice(
      bookingSource.indexOf("const handleStripePayment = async () =>"),
      bookingSource.indexOf("return (", bookingSource.indexOf("const handleStripePayment = async () =>")),
    );

    expect(paymentHandler).toMatch(
      /if \(existingBooking\) \{[\s\S]*?bookingId = existingBooking\.id;[\s\S]*?modifyToken = existingBooking\.modifyToken;[\s\S]*?\} else \{[\s\S]*?createServerBooking\("stripe"\)/,
    );
    expect(paymentHandler.match(/createServerBooking\("stripe"\)/g)).toHaveLength(1);
    expect(paymentHandler).toContain("getBookingPaymentStatus(modifyToken)");
    expect(paymentHandler).toContain("statusResult.payment.canRetryCard");
  });

  it("retains a strong booking attempt id across an ambiguous network response", () => {
    const bookingSource = source("src/pages/Booking.tsx");

    expect(bookingSource).toContain("globalThis.crypto.randomUUID()");
    expect(bookingSource).toContain("sessionStorage.setItem(BOOKING_ATTEMPT_SESSION_KEY, attemptId)");
    expect(bookingSource).toContain("bookingAttemptId,");
    expect(bookingSource).toContain("result.statusCode < 500");
    expect(bookingSource).toContain("definitiveClientRejection");
    expect(bookingSource).toContain("clearBookingAttemptId()");
  });

  it("keeps the main-only normalized status endpoint out of tenant refreshes", () => {
    const modifySource = source("src/pages/BookingModify.tsx");
    const refreshStart = modifySource.indexOf("const refreshAuthoritativePayment = useCallback");
    const refreshEnd = modifySource.indexOf("useEffect(() =>", refreshStart);
    const refreshBlock = modifySource.slice(refreshStart, refreshEnd);

    expect(refreshBlock).toMatch(
      /if \(booking\?\.tenantSlug\) \{[\s\S]*?fetchBookingByToken\(token\)[\s\S]*?return;[\s\S]*?getBookingPaymentStatus\(token\)/,
    );
    expect(modifySource).toContain("tenantPaymentVerificationPending");
    expect(modifySource).toContain("We’re confirming your card payment with Stripe. Don’t pay again while this is processing.");
    expect(modifySource).toContain('authoritativePayment?.paymentStatus === "cash"');
    expect(modifySource).toContain('paymentState !== "not-payable"');
  });

  it("switches main-site PayID to manual pending confirmation before revealing details", () => {
    const bookingSource = source("src/pages/Booking.tsx");
    const modifySource = source("src/pages/BookingModify.tsx");
    const apiSource = source("src/lib/api.ts");
    const bookingPaymentStep = bookingSource.slice(
      bookingSource.indexOf("{/* ─── Payment Step ─── */}"),
      bookingSource.indexOf("{/* ─── Confirmation ─── */}"),
    );

    expect(modifySource).toContain("selectBookingBankTransfer(booking.modifyToken)");
    expect(modifySource).toContain("Bank transfer selected — complete it using the details below");
    expect(modifySource).toContain("Contact the photographer before sending money");
    expect(apiSource).toContain('JSON.stringify({ action: "select-bank" })');
    expect(apiSource).not.toMatch(/selectBookingBankTransfer[\s\S]{0,1200}paymentStatus:\s*["']paid["']/);
    expect(bookingPaymentStep).not.toContain("bankTransfer.payId");
    expect(bookingSource).toMatch(/bankPaymentPending[\s\S]*?settings\.bankTransfer\.payId/);
    expect(modifySource).toMatch(/isBankPending && bankTransfer\.enabled[\s\S]*?bankTransfer\.payId/);
  });
});
