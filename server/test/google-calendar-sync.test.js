const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const calendarSource = fs.readFileSync(path.join(__dirname, "..", "google-calendar.js"), "utf8");
const adminSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "pages", "Admin.tsx"), "utf8");
const tenantAdminSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "pages", "TenantAdmin.tsx"), "utf8");

test("canonical booking mutations own Google Calendar status updates", () => {
  assert.match(indexSource, /queueBookingCalendarSync\(booking, calendarAction\)/);
  assert.match(indexSource, /queueBookingCalendarSync\(allBookings\[idx\], calendarAction\)/);
  assert.doesNotMatch(adminSource, /syncBookingToCalendar\(/);
  assert.doesNotMatch(tenantAdminSource, /syncTenantBookingToCalendar\(/);
});

test("Calendar updates recover from missing or stale event ids", () => {
  assert.match(indexSource, /\["create", "reschedule"\]\.includes\(action\)/);
  assert.match(indexSource, /privateExtendedProperty: \[`watermarkVaultBookingId=\$\{booking\.id\}`\]/);
  assert.match(indexSource, /status !== 404 && status !== 410/);
  assert.match(indexSource, /for \(const eventId of await findLinkedEventIds\(calendarId\)\) eventIds\.add\(eventId\)/);
  assert.match(calendarSource, /privateExtendedProperty: \[`watermarkVaultBookingId=\$\{booking\.id\}`\]/);
  assert.match(indexSource, /booking\.status === "confirmed" \? "2"/);
  assert.match(indexSource, /booking\.paymentStatus \? `Payment:/);
});

test("Calendar ownership follows events and deletion fails closed when cleanup fails", () => {
  assert.match(indexSource, /gcalCalendarId/);
  assert.match(indexSource, /booking\.gcalCalendarId !== connection\.calendarId/);
  assert.match(indexSource, /CALENDAR_CLEANUP_FAILED/);
  assert.match(indexSource, /persistBookingCalendarEventLink\(booking\.id, eventId, connection\.calendarId\)/);
  assert.match(calendarSource, /saveGcalEventId\(booking\.id, eventId, calId\)/);
});

test("manual Calendar helpers defer to the configured calendar unless explicitly overridden", () => {
  const apiSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "api.ts"), "utf8");
  assert.match(apiSource, /syncBookingToCalendar\(booking: unknown, calendarId\?: string\)/);
  assert.match(apiSource, /\.\.\.\(calendarId \? \{ calendarId \} : \{\}\)/);
  assert.doesNotMatch(apiSource, /syncBookingToCalendar\(booking: unknown, calendarId = "primary"\)/);
});
