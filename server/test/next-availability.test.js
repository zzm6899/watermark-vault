const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { generateAvailableSlots } = require('../security-core');
const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
const ctx = vm.createContext({ generateAvailableSlots });
vm.runInContext(source.slice(source.indexOf('async function findPublicAvailability('), source.indexOf('app.get("/api/availability",')), ctx);
const eventType = { id: 'shoot', durations: [30, 60], slotIntervalMinutes: 30, availability: { recurring: [], specificDates: ['2026-10-09', '2026-11-01', '2026-11-02'].map(date => ({ date, startTime: '09:00', endTime: '10:00' })), blockedDates: [] } };
const base = { eventType, date: '2026-10-09', duration: 30, timezone: 'Australia/Sydney', tenantSlug: null, bookings: [], now: new Date('2026-09-22T00:00:00Z') };
const booking = { id: 'booked', eventTypeId: 'shoot', date: '2026-10-09', time: '09:00', duration: 60, status: 'confirmed' };

test('next availability skips booked days and external calendar conflicts across months', async () => {
  const checked = [];
  const result = await ctx.findPublicAvailability({ ...base, bookings: [booking] }, true, async (_tenant, date) => {
    checked.push(date);
    return date === '2026-11-01' ? [{ ...booking, date }] : [];
  });
  assert.equal(result.date, '2026-11-02');
  assert.deepEqual([...result.slots], ['09:00', '09:30']);
  assert.deepEqual(checked, ['2026-11-01', '2026-11-02']);
});

test('duration, buffers, tenant isolation and explicit date selection remain authoritative', async () => {
  const partial = { ...booking, time: '09:30', duration: 30 };
  const busy = async () => [];
  assert.equal((await ctx.findPublicAvailability({ ...base, bookings: [partial] }, true, busy)).date, '2026-10-09');
  assert.equal((await ctx.findPublicAvailability({ ...base, duration: 60, bookings: [partial] }, true, busy)).date, '2026-11-01');
  assert.equal((await ctx.findPublicAvailability({ ...base, eventType: { ...eventType, bufferMinutes: 10 }, bookings: [partial] }, true, busy)).date, '2026-11-01');
  assert.equal((await ctx.findPublicAvailability({ ...base, tenantSlug: 'other', bookings: [booking] }, true, busy)).date, '2026-10-09');
  const manual = await ctx.findPublicAvailability({ ...base, bookings: [booking] }, false, busy);
  assert.equal(manual.date, '2026-10-09'); assert.equal(manual.slots.length, 0);
});

test('empty search ends and calendar errors do not masquerade as fully booked dates', async () => {
  const none = await ctx.findPublicAvailability({ ...base, eventType: { ...eventType, availability: {} } }, true, async () => { throw new Error('must not fetch'); });
  assert.equal(none.date, null); assert.equal(none.slots.length, 0);
  await assert.rejects(ctx.findPublicAvailability(base, true, async () => { throw new Error('calendar offline'); }), /calendar offline/);
});
